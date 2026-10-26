/* Lumen Tab — 轻量 Markdown 渲染（无外部依赖，先转义再生成标签） */
(function (root) {
  'use strict';

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeHref(value) {
    var raw = String(value == null ? '' : value).trim().replace(/^</, '').replace(/>$/, '');
    if (!/^https?:\/\//i.test(raw) || /[\s<>"']/.test(raw)) return '';
    try {
      var url = new URL(raw);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
      return escapeHtml(url.href);
    } catch (err) {
      return '';
    }
  }

  function renderInline(value) {
    var tokens = [];
    function hold(html) {
      tokens.push(html);
      return '\u0000' + (tokens.length - 1) + '\u0000';
    }

    var text = String(value == null ? '' : value).replace(/\u0000/g, '');

    // 先取出代码与链接，避免内部字符被后续强调规则改动
    text = text.replace(/`([^`\n]+)`/g, function (all, code) {
      return hold('<code>' + escapeHtml(code) + '</code>');
    });
    text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, function (all, label, href) {
      var safe = safeHref(href);
      if (!safe) return all;
      return hold('<a href="' + safe + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(label) + '</a>');
    });
    text = text.replace(/(^|[\s(])(https?:\/\/[^\s<)\]]+)/g, function (all, before, url) {
      var tail = '';
      while (/[.,;:!?，。；：！？、]$/.test(url)) {
        tail = url.slice(-1) + tail;
        url = url.slice(0, -1);
      }
      var safe = safeHref(url);
      if (!safe) return all;
      return before + hold('<a href="' + safe + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(url) + '</a>') + tail;
    });

    text = escapeHtml(text);
    text = text.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/~~([^~\n]+?)~~/g, '<del>$1</del>');
    text = text.replace(/(^|[^*\w])\*([^*\n]+?)\*(?![*])/g, '$1<em>$2</em>');
    text = text.replace(/\u0000(\d+)\u0000/g, function (all, index) {
      return tokens[Number(index)] || '';
    });
    return text;
  }

  function leadingSpaces(line) {
    var match = /^[ \t]*/.exec(line);
    return (match ? match[0] : '').replace(/\t/g, '    ').length;
  }

  function listMatch(line) {
    var match = /^([ \t]*)([-*+]|\d+[.)])\s+(.+)$/.exec(line);
    if (!match) return null;
    return {
      indent: match[1].replace(/\t/g, '    ').length,
      ordered: /^\d/.test(match[2]),
      text: match[3]
    };
  }

  function splitTableRow(line) {
    var text = line.trim();
    if (text.charAt(0) === '|') text = text.slice(1);
    if (text.charAt(text.length - 1) === '|') text = text.slice(0, -1);
    return text.split('|').map(function (cell) { return cell.trim(); });
  }

  function tableSeparator(line) {
    var cells = splitTableRow(line);
    return cells.length >= 2 && cells.every(function (cell) {
      return /^:?-{3,}:?$/.test(cell);
    });
  }

  function tableStart(lines, index) {
    return index + 1 < lines.length && lines[index].indexOf('|') >= 0 && tableSeparator(lines[index + 1]);
  }

  function isBlockStart(lines, index) {
    var line = lines[index];
    if (!line.trim()) return true;
    if (/^#{1,6}\s+/.test(line)) return true;
    if (/^\s*(`{3,}|~{3,})/.test(line)) return true;
    if (/^\s*>\s?/.test(line)) return true;
    if (/^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line)) return true;
    if (listMatch(line)) return true;
    if (tableStart(lines, index)) return true;
    return false;
  }

  function renderList(lines, start, baseIndent, ordered) {
    var items = [];
    var current = null;
    var i = start;

    while (i < lines.length) {
      var item = listMatch(lines[i]);
      if (item) {
        if (item.indent === baseIndent) {
          if (item.ordered !== ordered) break;
          current = { text: item.text, children: [] };
          items.push(current);
          i++;
          continue;
        }
        if (item.indent > baseIndent && current) {
          var nested = renderList(lines, i, item.indent, item.ordered);
          current.children.push(nested.html);
          i = nested.next;
          continue;
        }
        break;
      }

      if (!lines[i].trim()) {
        var j = i + 1;
        while (j < lines.length && !lines[j].trim()) j++;
        var next = j < lines.length ? listMatch(lines[j]) : null;
        if (next && next.indent >= baseIndent) {
          i = j;
          continue;
        }
        break;
      }

      if (current && leadingSpaces(lines[i]) > baseIndent) {
        current.text += ' ' + lines[i].trim();
        i++;
        continue;
      }
      break;
    }

    var tag = ordered ? 'ol' : 'ul';
    var html = '<' + tag + '>' + items.map(function (entry) {
      return '<li>' + renderInline(entry.text) + entry.children.join('') + '</li>';
    }).join('') + '</' + tag + '>';
    return { html: html, next: i };
  }

  function renderCode(code, lang) {
    var language = /^[A-Za-z0-9_+.#-]{1,24}$/.test(lang || '') ? lang : '';
    var label = language || '代码';
    return '<div class="md-code">' +
      '<div class="md-code__head"><span>' + escapeHtml(label) + '</span>' +
      '<button type="button" class="md-code__copy" data-md-copy aria-label="复制代码">复制</button></div>' +
      '<pre><code' + (language ? ' class="language-' + language + '"' : '') + '>' +
      escapeHtml(code) + '</code></pre></div>';
  }

  function renderTable(lines, index) {
    var headers = splitTableRow(lines[index]);
    var aligns = splitTableRow(lines[index + 1]).map(function (cell) {
      var left = cell.charAt(0) === ':';
      var right = cell.charAt(cell.length - 1) === ':';
      if (left && right) return 'center';
      if (right) return 'right';
      if (left) return 'left';
      return '';
    });
    var i = index + 2;
    var rows = [];
    while (i < lines.length && lines[i].trim() && lines[i].indexOf('|') >= 0) {
      rows.push(splitTableRow(lines[i]));
      i++;
    }

    var head = headers.map(function (cell, cellIndex) {
      var align = aligns[cellIndex] ? ' class="md-align-' + aligns[cellIndex] + '"' : '';
      return '<th' + align + '>' + renderInline(cell) + '</th>';
    }).join('');
    var body = rows.map(function (row) {
      return '<tr>' + headers.map(function (all, cellIndex) {
        var align = aligns[cellIndex] ? ' class="md-align-' + aligns[cellIndex] + '"' : '';
        return '<td' + align + '>' + renderInline(row[cellIndex] || '') + '</td>';
      }).join('') + '</tr>';
    }).join('');

    return {
      html: '<div class="md-table-wrap"><table><thead><tr>' + head + '</tr></thead>' +
        (body ? '<tbody>' + body + '</tbody>' : '') + '</table></div>',
      next: i
    };
  }

  function render(source) {
    var lines = String(source == null ? '' : source)
      .replace(/\r\n?/g, '\n')
      .replace(/\u0000/g, '')
      .split('\n');
    var output = [];
    var i = 0;

    while (i < lines.length) {
      var line = lines[i];

      if (!line.trim()) {
        i++;
        continue;
      }

      var fence = /^\s*(`{3,}|~{3,})\s*(.*)$/.exec(line);
      if (fence) {
        var marker = fence[1].charAt(0);
        var lang = fence[2].trim().split(/\s+/)[0];
        var code = [];
        var closeRe = new RegExp('^\\s*' + marker + '{3,}\\s*$');
        i++;
        while (i < lines.length && !closeRe.test(lines[i])) {
          code.push(lines[i]);
          i++;
        }
        if (i < lines.length) i++;
        output.push(renderCode(code.join('\n'), lang));
        continue;
      }

      var heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (heading) {
        var level = heading[1].length;
        output.push('<h' + level + '>' + renderInline(heading[2]) + '</h' + level + '>');
        i++;
        continue;
      }

      if (/^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line)) {
        output.push('<hr>');
        i++;
        continue;
      }

      if (/^\s*>\s?/.test(line)) {
        var quote = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          quote.push(lines[i].replace(/^\s*>\s?/, ''));
          i++;
        }
        output.push('<blockquote>' + render(quote.join('\n')) + '</blockquote>');
        continue;
      }

      if (tableStart(lines, i)) {
        var table = renderTable(lines, i);
        output.push(table.html);
        i = table.next;
        continue;
      }

      var list = listMatch(line);
      if (list) {
        var listResult = renderList(lines, i, list.indent, list.ordered);
        output.push(listResult.html);
        i = listResult.next;
        continue;
      }

      var paragraph = [];
      while (i < lines.length && lines[i].trim() && !isBlockStart(lines, i)) {
        paragraph.push(renderInline(lines[i].trim()));
        i++;
      }
      if (paragraph.length) output.push('<p>' + paragraph.join('<br>') + '</p>');
      else i++;
    }

    return output.join('');
  }

  root.LumenMarkdown = { render: render, inline: renderInline, escapeHtml: escapeHtml };

  if (typeof module === 'object' && module.exports) module.exports = root.LumenMarkdown;
})(typeof globalThis !== 'undefined' ? globalThis : this);
