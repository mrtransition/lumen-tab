/* Lumen Tab — OpenAI 兼容 Chat Completions 客户端（仅在 API 模式主动调用） */
(function (root) {
  'use strict';

  function endpointFor(baseUrl) {
    var base = String(baseUrl || '').trim().replace(/\/+$/, '');
    if (!base) return '';
    if (/\/chat\/completions$/i.test(base)) return base;
    return base + '/chat/completions';
  }

  function textOf(content) {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content.map(function (part) {
      if (typeof part === 'string') return part;
      if (!part || typeof part !== 'object') return '';
      if (typeof part.text === 'string') return part.text;
      if (typeof part.content === 'string') return part.content;
      return '';
    }).join('');
  }

  function reasoningOf(obj) {
    if (!obj || typeof obj !== 'object') return '';
    if (obj.reasoning_content != null) return textOf(obj.reasoning_content);
    if (obj.reasoning != null) return textOf(obj.reasoning);
    if (obj.thinking != null) return textOf(obj.thinking);
    return '';
  }

  var THINK_TAG_RE = /^<\s*(\/?)\s*(think|thinking|thought|reasoning)\s*>/i;

  function matchThinkTag(rest) {
    var m = THINK_TAG_RE.exec(rest);
    return m ? { close: m[1] === '/', length: m[0].length } : null;
  }

  /**
   * 把模型内联的 think 标签拆成思考与正文，支持标签被 chunk 切断。
   * onAnswer / onReasoning 会在流式过程中收到增量片段。
   */
  function createThinkFilter(onAnswer, onReasoning) {
    var mode = 'answer';
    var buffer = '';

    function emit(kind, piece) {
      if (!piece) return;
      if (kind === 'reasoning') {
        if (typeof onReasoning === 'function') onReasoning(piece);
      } else if (typeof onAnswer === 'function') {
        onAnswer(piece);
      }
    }

    function process(final) {
      var i = 0;
      while (i < buffer.length) {
        if (buffer.charAt(i) !== '<') {
          var next = buffer.indexOf('<', i);
          if (next < 0) {
            emit(mode, buffer.slice(i));
            i = buffer.length;
            break;
          }
          emit(mode, buffer.slice(i, next));
          i = next;
          continue;
        }

        var rest = buffer.slice(i);
        var tag = matchThinkTag(rest);
        if (tag) {
          if (tag.close) {
            if (mode === 'reasoning') mode = 'answer';
          } else {
            mode = 'reasoning';
          }
          i += tag.length;
          continue;
        }

        // 可能是被网络 chunk 切开的标签，先保留到下一段；否则按普通文本输出。
        var closeIdx = rest.indexOf('>');
        if (closeIdx < 0 && rest.length <= 20 && !final) break;
        emit(mode, '<');
        i++;
      }
      buffer = buffer.slice(i);
    }

    return {
      push: function (chunk) {
        if (!chunk) return;
        buffer += chunk;
        process(false);
      },
      flush: function () { process(true); },
      reasoning: function (chunk) {
        if (chunk) emit('reasoning', chunk);
      }
    };
  }

  function splitThink(text) {
    var answer = '';
    var reasoning = '';
    var filter = createThinkFilter(
      function (piece) { answer += piece; },
      function (piece) { reasoning += piece; }
    );
    filter.push(text);
    filter.flush();
    return { text: answer, reasoning: reasoning };
  }

  function joinReasoning(separate, inline) {
    return [separate, inline].filter(function (s) { return s && s.trim(); }).join('\n\n').trim();
  }

  function configError(config) {
    if (!config || !config.baseUrl) return '请填写 API 接口地址';
    if (!/^https?:\/\/[^\s]+$/i.test(config.baseUrl)) return '接口地址必须以 http:// 或 https:// 开头';
    if (!config.model) return '请填写模型名称';
    if (!/^[A-Za-z0-9._:@/-]{1,100}$/.test(config.model)) return '模型名称只能包含字母、数字与 . _ : @ / -';
    if (config.apiKey && /[\u0000-\u001f\u007f\s]/.test(config.apiKey)) return 'API Key 含有空白或控制字符';
    return '';
  }

  function ApiError(message, status, detail) {
    var err = new Error(message);
    err.name = 'LumenApiError';
    err.status = status || 0;
    err.detail = detail || '';
    return err;
  }

  function readErrorMessage(res) {
    return res.text().catch(function () { return ''; }).then(function (raw) {
      var detail = '';
      try {
        var json = JSON.parse(raw);
        detail = (json && json.error && (json.error.message || json.error.code)) ||
          (json && (json.message || json.detail)) || '';
      } catch (err) {
        detail = raw;
      }
      detail = String(detail || '').replace(/\s+/g, ' ').trim().slice(0, 260);
      throw ApiError('接口返回 ' + res.status + (detail ? '：' + detail : ''), res.status, detail);
    });
  }

  function buildPayload(config, messages, stream, opts) {
    var temperature = Number(config.temperature);
    var maxTokens = Number((opts && opts.maxTokens) || config.maxTokens || 800);
    var payload = {
      model: config.model,
      messages: messages,
      stream: !!stream,
      temperature: Number.isFinite(temperature) ? Math.max(0, Math.min(2, temperature)) : 0.7
    };
    if (Number.isFinite(maxTokens) && maxTokens > 0) payload.max_tokens = Math.round(Math.max(1, Math.min(4096, maxTokens)));
    return payload;
  }

  /**
   * 调用 OpenAI 兼容接口。
   * messages: [{role, content}]
   * opts: { fetch, signal, onDelta, onReasoning, stream=false, timeout, maxTokens }
   */
  function chat(config, messages, opts) {
    opts = opts || {};
    var invalid = configError(config);
    if (invalid) return Promise.reject(ApiError(invalid));
    var fetchImpl = opts.fetch || (typeof root.fetch === 'function' ? root.fetch.bind(root) : null);
    if (!fetchImpl) return Promise.reject(ApiError('当前环境不支持网络请求'));

    var stream = opts.stream !== false;
    var controller = new AbortController();
    var timedOut = false;
    var timer = setTimeout(function () {
      timedOut = true;
      controller.abort();
    }, opts.timeout || 90000);
    var onAbort = function () { controller.abort(); };
    if (opts.signal) {
      if (opts.signal.aborted) controller.abort();
      else opts.signal.addEventListener('abort', onAbort, { once: true });
    }

    var headers = {
      'Content-Type': 'application/json',
      'Accept': stream ? 'text/event-stream' : 'application/json'
    };
    if (config.apiKey) headers.Authorization = 'Bearer ' + config.apiKey;

    var payload = buildPayload(config, messages, stream, opts);
    var endpoint = endpointFor(config.baseUrl);

    var request = fetchImpl(endpoint, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
      mode: 'cors',
      credentials: 'omit'
    }).then(function (res) {
      if (!res.ok) return readErrorMessage(res);
      var type = (res.headers && res.headers.get('content-type')) || '';
      if (stream && res.body && typeof res.body.getReader === 'function' && /text\/event-stream/i.test(type)) {
        return readStream(res, opts);
      }
      return res.json().catch(function () {
        throw ApiError('接口返回的不是有效 JSON');
      }).then(function (json) {
        if (json && json.error) {
          throw ApiError('接口返回错误：' + textOf(json.error.message || json.error.code).slice(0, 260));
        }
        var choice = json && json.choices && json.choices[0];
        if (!choice) throw ApiError('模型没有返回文本');
        var message = choice.message || {};
        var split = splitThink(textOf(message.content != null ? message.content : choice.text));
        var reasoning = joinReasoning(reasoningOf(message) || reasoningOf(choice), split.reasoning);
        if (!split.text) throw ApiError('模型没有返回文本');
        return { text: split.text, reasoning: reasoning, model: json.model || config.model, usage: json.usage || null };
      });
    }).catch(function (err) {
      if (timedOut) throw ApiError('请求超时，请检查网络或接口地址');
      if (err && err.name === 'AbortError') {
        var aborted = new Error('已停止生成');
        aborted.name = 'AbortError';
        throw aborted;
      }
      if (err && err.name === 'LumenApiError') throw err;
      throw ApiError('请求失败：' + ((err && err.message) || '未知错误') + '（请检查接口、Key、模型与跨域设置）');
    });

    return request.then(function (result) {
      result.text = String(result.text || '').trim();
      result.reasoning = String(result.reasoning || '').trim();
      if (!result.text) throw ApiError('模型没有返回文本');
      return result;
    }).finally(function () {
      clearTimeout(timer);
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
    });
  }

  function readStream(res, opts) {
    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    var text = '';
    var reasoning = '';
    var model = '';
    var usage = null;
    var filter = createThinkFilter(
      function (piece) {
        text += piece;
        if (typeof opts.onDelta === 'function') opts.onDelta(piece);
      },
      function (piece) {
        reasoning += piece;
        if (typeof opts.onReasoning === 'function') opts.onReasoning(piece);
      }
    );

    function handleLine(line) {
      line = line.replace(/\r$/, '');
      if (line.indexOf('data:') !== 0) return;
      var data = line.slice(5).trim();
      if (!data || data === '[DONE]') return;
      var json;
      try { json = JSON.parse(data); } catch (err) { return; }
      if (json.error) throw ApiError('接口返回错误：' + textOf(json.error.message || json.error.code).slice(0, 260));
      if (json.model) model = json.model;
      if (json.usage) usage = json.usage;
      var choice = json.choices && json.choices[0];
      if (!choice) return;
      var delta = choice.delta || choice.message || {};
      var thinking = reasoningOf(delta) || reasoningOf(choice);
      if (thinking) filter.reasoning(thinking);
      var piece = textOf(delta.content);
      if (piece) filter.push(piece);
    }

    function pump() {
      return reader.read().then(function (step) {
        if (step.done) {
          buffer += decoder.decode();
          if (buffer) handleLine(buffer);
          filter.flush();
          if (!text) throw ApiError('模型没有返回文本');
          return { text: text, reasoning: reasoning.trim(), model: model, usage: usage };
        }
        buffer += decoder.decode(step.value, { stream: true });
        var idx;
        while ((idx = buffer.indexOf('\n')) >= 0) {
          var line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          handleLine(line);
        }
        return pump();
      });
    }

    return pump();
  }

  function ping(config, opts) {
    return chat(config, [{ role: 'user', content: '只回复 OK' }], Object.assign({
      stream: false,
      timeout: 20000,
      maxTokens: 16
    }, opts || {}));
  }

  root.LumenAIApi = {
    endpointFor: endpointFor,
    configError: configError,
    chat: chat,
    ping: ping
  };

  if (typeof module === 'object' && module.exports) module.exports = root.LumenAIApi;
})(typeof globalThis !== 'undefined' ? globalThis : this);
