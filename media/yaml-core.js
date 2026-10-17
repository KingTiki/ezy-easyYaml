import { Composer, Parser, LineCounter, isMap, isSeq, isAlias, Document, YAMLMap, YAMLSeq, Pair } from 'yaml';

/* EZY - Easy YAML core. No DOM, file-system or network dependencies. */
(function (global) {
  'use strict';
  const SKIP = Symbol('not selected');
  const scalarTypes = ['string', 'number', 'boolean', 'null'];

  class ConfigurationError extends Error {
    constructor(message, line) {
      super((line ? 'Zeile ' + line + ': ' : '') + message);
      this.name = 'ConfigurationError';
      this.line = line || null;
    }
  }

  function typeOf(value) {
    if (value === null || value === undefined) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value === 'object' ? 'object' : typeof value;
  }

  function copyValue(value) {
    if (Array.isArray(value)) return value.map(copyValue);
    if (value && typeof value === 'object') {
      const result = Object.create(null);
      Object.keys(value).forEach(key => { result[key] = copyValue(value[key]); });
      return result;
    }
    return value === undefined ? null : value;
  }

  function parseDocument(text) {
    const lines = new LineCounter();
    const tokens = [...new Parser(lines.addNewLine).parse(text)];
    const documents = [...new Composer({
      schema: 'core', version: '1.2', resolveKnownTags: false,
      intAsBigInt: true, prettyErrors: false, logLevel: 'silent'
    }).compose(tokens, true, text.length)];
    const document = documents[0];
    if (documents.length !== 1) throw new ConfigurationError('Mehrere YAML-Dokumente werden nicht unterstützt.');
    const error = document.errors[0] || document.warnings[0];
    if (error) throw new ConfigurationError('Ungültiges oder nicht unterstütztes YAML: ' + error.message, lines.linePos(error.pos[0]).line);
    if (!document.contents) throw new ConfigurationError('Die Vorlage ist leer.');
    let count = 0;
    function convert(source, depth = 0) {
      const start = source?.range?.[0] ?? 0;
      const location = lines.linePos(start);
      if (++count > 30000 || depth > 100) throw new ConfigurationError('Die Vorlage ist zu groß oder zu tief verschachtelt.', location.line);
      if (isAlias(source) || source?.anchor) throw new ConfigurationError('Anker und Aliase werden nicht unterstützt.', location.line);
      const node = { start, end: source?.range?.[1] ?? start, line: location.line, indent: location.col - 1, children: [] };
      if (isMap(source)) {
        node.kind = 'mapping';
        node.value = Object.create(null);
        source.items.forEach(pair => {
          const key = convert(pair.key, depth + 1);
          if (key.kind !== 'scalar' || typeof key.value !== 'string') throw new ConfigurationError('Nur einfache Textschlüssel werden unterstützt; komplexe oder typisierte Schlüssel bitte in Anführungszeichen setzen.', key.line);
          const value = convert(pair.value, depth + 1);
          node.children.push(key, value);
          node.value[key.value] = value.value;
        });
      } else if (isSeq(source)) {
        node.kind = 'sequence';
        node.children = source.items.map(item => convert(item, depth + 1));
        node.value = node.children.map(item => item.value);
      } else {
        node.kind = 'scalar';
        const value = source?.value ?? null;
        if ((typeof value === 'number' && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) ||
            (typeof value === 'bigint' && (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)))) {
          throw new ConfigurationError('Diese Zahl lässt sich nicht verlustfrei bearbeiten.', location.line);
        }
        node.value = typeof value === 'bigint' ? Number(value) : value;
      }
      return node;
    }
    const root = convert(document.contents);
    const comments = [];
    function collect(token) {
      if (!token || typeof token !== 'object') return;
      if (token.type === 'comment') comments.push(token);
      else Object.values(token).forEach(value => {
        if (Array.isArray(value)) value.forEach(collect);
        else if (value && typeof value === 'object') collect(value);
      });
    }
    tokens.forEach(collect);
    root.comments = comments.sort((a, b) => a.offset - b.offset).map(token => {
      const location = lines.linePos(token.offset);
      const column = location.col - 1;
      return { line: location.line - 1, column, position: token.offset,
        inline: !!text.slice(token.offset - column, token.offset).trim(), text: token.source.replace(/^# ?/, '') };
    });
    return root;
  }

  function buildNode(ast, key, path, context, keyAst) {
    const type = typeOf(ast.value);
    const position = keyAst || ast;
    const node = {
      id: 'field-' + context.nextId++, key, path: path.slice(), type,
      originalValue: copyValue(ast.value), children: [], hints: [],
      line: position.line, indent: position.indent, start: position.start,
      end: ast.end, source: 'active'
    };
    if (type === 'object') {
      for (let i = 0; i < ast.children.length; i += 2) {
        const childKey = ast.children[i];
        node.children.push(buildNode(ast.children[i + 1], childKey.value, path.concat(childKey.value), context, childKey));
      }
    } else if (type === 'array') {
      node.children = ast.children.map((child, index) => buildNode(child, index, path.concat(index), context));
    }
    return node;
  }

  function walk(node, visit) {
    visit(node);
    node.children.forEach(child => walk(child, visit));
  }

  // The parser identifies comments; only their placement in the UI is ours.
  function attachComments(text, ast, root) {
    const nodes = [];
    walk(root, node => { if (node.key !== null) nodes.push(node); });
    nodes.sort((a, b) => a.start - b.start);
    const lines = text.split('\n');
    const comments = ast.comments;
    for (let index = 0; index < comments.length; index++) {
      const first = comments[index];
      let last = first;
      const content = [first.text];
      if (!first.inline) {
        while (index + 1 < comments.length) {
          const next = comments[index + 1];
          if (next.inline || next.column !== first.column || lines.slice(last.line + 1, next.line).some(line => line.trim())) break;
          for (let line = last.line + 1; line < next.line; line++) content.push('');
          content.push(next.text);
          last = next;
          index++;
        }
      }
      let target;
      if (first.inline) {
        const candidates = nodes.filter(node => node.line === first.line + 1 && node.indent < first.column);
        target = candidates.find(node => node.end <= first.position) || candidates.pop();
      } else {
        let nextLine = last.line + 1;
        while (nextLine < lines.length && !lines[nextLine].trim()) nextLine++;
        target = nodes.find(node => node.line === nextLine + 1 && node.indent === first.column);
        if (!target) target = nodes.filter(node => node.line < first.line + 1 && node.indent <= first.column).pop();
      }
      (target || root).hints.push(content.join('\n'));
    }
  }

  function parseTemplate(text) {
    if (typeof text !== 'string') throw new ConfigurationError('Die Vorlage muss Text enthalten.');
    if (text.length > 5 * 1024 * 1024) throw new ConfigurationError('Die Vorlage darf höchstens 5 MB groß sein.');
    text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const ast = parseDocument(text);
    if (ast.kind !== 'mapping') throw new ConfigurationError('Die Vorlage muss ein YAML-Objekt als Wurzel enthalten.');
    const context = { nextId: 1 };
    const root = buildNode(ast, null, [], context);
    root.indent = -1;
    attachComments(text, ast, root);
    return { root, nextId: context.nextId };
  }

  function cloneNode(node) {
    return { ...node, path: node.path.slice(), children: node.children.map(cloneNode), hints: node.hints.slice() };
  }

  function register(node, selection, selected) {
    selection.fields[node.id] = { selected: !!selected, type: node.type, value: copyValue(node.originalValue), error: '' };
    node.children.forEach(child => register(child, selection, selected));
  }

  function createInitialSelection(template) {
    const selection = { root: cloneNode(template.root), fields: Object.create(null), nextId: template.nextId };
    register(selection.root, selection, false);
    return selection;
  }

  function importExport(template, text) {
    if (typeof text !== 'string' || text.length > 5 * 1024 * 1024) throw new ConfigurationError('Der Export muss YAML-Text mit höchstens 5 MB enthalten.');
    const ast = parseDocument(text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'));
    if (ast.kind !== 'mapping') throw new ConfigurationError('Der Export muss ein YAML-Objekt als Wurzel enthalten.');
    const selection = createInitialSelection(template);
    function merge(parent, values) {
      Object.keys(values).forEach(key => {
        const value = values[key];
        const index = parent.children.findIndex(child => child.key === key);
        const existing = parent.children[index];
        if (existing && existing.type === 'object' && typeOf(value) === 'object' && Object.keys(value).length) {
          merge(existing, value);
        } else if (existing && scalarTypes.includes(existing.type) && scalarTypes.includes(typeOf(value))) {
          setValue(selection, existing.id, value, typeOf(value));
          setSelected(selection, existing.id, true);
        } else {
          const node = nodeFromValue(value, key, parent.path.concat(key), selection);
          if (existing) {
            node.hints = existing.hints.slice();
            walk(existing, child => { delete selection.fields[child.id]; });
            parent.children[index] = node;
          } else parent.children.push(node);
          register(node, selection, true);
        }
      });
    }
    merge(selection.root, ast.value);
    return selection;
  }

  function findNode(selection, id) {
    let result;
    walk(selection.root, node => { if (node.id === id) result = node; });
    if (!result) throw new ConfigurationError('Unbekanntes Feld.');
    return result;
  }

  function getStatus(node, selection) {
    if (node.key === null && !node.children.length) return { selected: false, partial: false, count: 0, total: 0 };
    if (node.children.length) {
      const children = node.children.map(child => getStatus(child, selection));
      return { selected: children.every(child => child.selected), partial: children.some(child => child.selected || child.partial) && !children.every(child => child.selected), count: children.reduce((sum, child) => sum + child.count, 0), total: children.reduce((sum, child) => sum + child.total, 0) };
    }
    const selected = selection.fields[node.id].selected;
    return { selected, partial: false, count: selected ? 1 : 0, total: node.key === null ? 0 : 1 };
  }

  function setSelected(selection, id, selected) {
    walk(findNode(selection, id), node => { selection.fields[node.id].selected = !!selected; });
  }

  function setValue(selection, id, value, type) {
    const node = findNode(selection, id);
    const field = selection.fields[id];
    if (node.type === 'object' || node.type === 'array') throw new ConfigurationError('Gruppen werden über ihre Unterfelder bearbeitet.');
    type = type || field.type;
    if (!scalarTypes.includes(type)) throw new ConfigurationError('Unbekannter Werttyp.');
    field.type = type;
    field.error = '';
    if (type === 'number') {
      const text = String(value).trim();
      const number = Number(text);
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text) || !Number.isFinite(number) || (Number.isInteger(number) && !Number.isSafeInteger(number))) field.error = 'Bitte eine gültige, verlustfrei darstellbare Zahl eingeben.';
      field.value = field.error ? String(value) : number;
    } else if (type === 'boolean') {
      field.value = value === true || value === 'true';
    } else if (type === 'null') {
      field.value = null;
    } else {
      field.value = String(value === null || value === undefined ? '' : value);
    }
    return field;
  }

  function nodeFromValue(value, key, path, selection) {
    const node = { id: 'field-' + selection.nextId++, key, path: path.slice(), type: typeOf(value), originalValue: copyValue(value), children: [], hints: [], line: null, indent: 0, start: 0, end: 0, source: 'new' };
    if (Array.isArray(value)) node.children = value.map((child, index) => nodeFromValue(child, index, path.concat(index), selection));
    else if (value && typeof value === 'object') node.children = Object.keys(value).map(childKey => nodeFromValue(value[childKey], childKey, path.concat(childKey), selection));
    return node;
  }

  function defaultValue(type) {
    return ({ string: '', number: 0, boolean: false, null: null, array: [], object: Object.create(null) })[type];
  }

  function addItem(selection, parentId, type, key) {
    const parent = findNode(selection, parentId);
    if (parent.type !== 'array' && parent.type !== 'object') throw new ConfigurationError('Hier können keine Einträge hinzugefügt werden.');
    if (parent.type === 'object') {
      if (typeof key !== 'string' || !key.trim()) throw new ConfigurationError('Bitte einen Feldnamen eingeben.');
      if (parent.children.some(child => child.key === key)) throw new ConfigurationError('Dieser Feldname existiert bereits.');
    } else key = parent.children.length;
    let value;
    if (type === 'example') {
      if (!parent.children.length) value = '';
      else {
        const example = parent.children[0];
        value = example.type === 'object' || example.type === 'array' ? materializeExample(example) : example.originalValue;
      }
    } else {
      if (!scalarTypes.concat(['object', 'array']).includes(type)) throw new ConfigurationError('Unbekannter Eintragstyp.');
      value = defaultValue(type);
    }
    const node = nodeFromValue(value, key, parent.path.concat(key), selection);
    parent.children.push(node);
    register(node, selection, true);
    return node;
  }

  function materializeExample(node) {
    if (node.type === 'array') return node.children.map(materializeExample);
    if (node.type === 'object') {
      const result = Object.create(null);
      node.children.forEach(child => { result[child.key] = materializeExample(child); });
      return result;
    }
    return copyValue(node.originalValue);
  }

  function removeItem(selection, parentId, id) {
    const parent = findNode(selection, parentId);
    const index = parent.children.findIndex(child => child.id === id);
    if (index < 0) throw new ConfigurationError('Unbekannter Eintrag.');
    const removed = parent.children.splice(index, 1)[0];
    walk(removed, node => { delete selection.fields[node.id]; });
    function updatePath(node, path) { node.path = path; node.children.forEach(child => updatePath(child, path.concat(child.key))); }
    if (parent.type === 'array') parent.children.forEach((child, childIndex) => { child.key = childIndex; updatePath(child, parent.path.concat(childIndex)); });
  }

  function serializeSelection(template, selection) {
    if (!template || !selection) throw new ConfigurationError('Bitte zuerst eine Vorlage laden.');
    const keyOrder = new WeakMap();
    function selectedValue(node) {
      const field = selection.fields[node.id];
      if (node.type === 'object' || node.type === 'array') {
        const value = node.type === 'object' ? Object.create(null) : [];
        if (node.type === 'object') keyOrder.set(value, []);
        let count = 0;
        node.children.forEach(child => {
          const item = selectedValue(child);
          if (item === SKIP) return;
          if (Array.isArray(value)) value.push(item);
          else { value[child.key] = item; keyOrder.get(value).push(child.key); }
          count++;
        });
        if (count || (!node.children.length && field.selected && node.key !== null)) return value;
        return SKIP;
      }
      if (!field.selected) return SKIP;
      if (field.error) throw new ConfigurationError(formatPath(node.path) + ': ' + field.error);
      return field.value;
    }
    const value = selectedValue(selection.root);
    if (value === SKIP) return '';
    const document = new Document(undefined, { schema: 'core' });
    function encode(item) {
      if (Array.isArray(item)) {
        const sequence = new YAMLSeq(document.schema);
        sequence.items = item.map(encode);
        return sequence;
      }
      if (item !== null && typeof item === 'object') {
        const mapping = new YAMLMap(document.schema);
        mapping.items = (keyOrder.get(item) || Object.keys(item)).map(key => {
          const scalar = document.createNode(key);
          if (/[\n\r]/.test(key)) scalar.type = 'QUOTE_DOUBLE';
          return new Pair(scalar, encode(item[key]));
        });
        return mapping;
      }
      return document.createNode(item);
    }
    document.contents = encode(value);
    return document.toString({ indent: 2, lineWidth: 0, singleQuote: false });
  }

  function formatPath(path) {
    return path.map((segment, index) => typeof segment === 'number' ? '[' + segment + ']' : (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(segment) ? (index ? '.' : '') + segment : '[' + JSON.stringify(segment) + ']')).join('');
  }

  global.YamlStudio = Object.freeze({ ConfigurationError, parseTemplate, createInitialSelection, importExport, serializeSelection, setSelected, setValue, addItem, removeItem, getStatus, findNode, formatPath, walk });
})(globalThis);
