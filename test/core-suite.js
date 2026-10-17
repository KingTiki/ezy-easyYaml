/* Runs unchanged in the browser or in a small Node verification harness. */
(function (global) {
  'use strict';
  const c = global.YamlStudio;
  const yaml = global.YamlTestParser;
  function assert(condition, message) { if (!condition) throw new Error(message || 'Erwartung nicht erfüllt.'); }
  function equal(actual, expected) { assert(JSON.stringify(actual) === JSON.stringify(expected), JSON.stringify(actual) + ' ≠ ' + JSON.stringify(expected)); }
  function field(root, path) {
    let found;
    c.walk(root, node => { if (JSON.stringify(node.path) === JSON.stringify(path)) found = node; });
    assert(found, 'Feld fehlt: ' + JSON.stringify(path));
    return found;
  }
  function setup(text) { const template = c.parseTemplate(text); return { template, selection: c.createInitialSelection(template) }; }
  function exportValue(template, selection) {
    const text = c.serializeSelection(template, selection);
    return text ? yaml.parse(text) : undefined;
  }
  function select(selection, path, selected) { c.setSelected(selection, field(selection.root, path).id, selected === undefined ? true : selected); }
  function throws(action, text) {
    let error;
    try { action(); } catch (caught) { error = caught; }
    assert(error, 'Ein Fehler wurde erwartet.');
    if (text) assert(error.message.includes(text), error.message);
  }
  function run(fixture) {
    const results = [];
    function test(name, action) {
      try { action(); results.push({ name, passed: true }); }
      catch (error) { results.push({ name, passed: false, error: error.message }); }
    }
    test('Beispielvorlage: nur aktive Felder sind bearbeitbar', () => {
      const { template, selection } = setup(fixture);
      equal(c.getStatus(selection.root, selection).total, 16);
      equal(field(template.root, ['app']).children.some(node => node.key === 'baseURL'), false);
      assert(field(template.root, ['app', 'feature']).hints.join('\n').includes('baseURL: https://example.org'));
      const password = field(selection.root, ['app', 'security', 'credentials', 'users', 'reader', 'password']);
      equal(password.originalValue, 'replace-me');
      assert(password.hints.join('\n').includes('password: "local-demo"'));
      c.setSelected(selection, selection.root.id, true);
      equal(exportValue(template, selection), yaml.parse(fixture));
    });
    test('Initialzustand enthält keine Auswahl', () => {
      const { template, selection } = setup('a: x\nb: true\n');
      equal(c.serializeSelection(template, selection), '');
      equal(c.getStatus(selection.root, selection).count, 0);
      const empty = setup('{}\n');
      c.setSelected(empty.selection, empty.selection.root.id, true);
      equal(c.getStatus(empty.selection.root, empty.selection).count, 0);
      equal(c.serializeSelection(empty.template, empty.selection), '');
    });
    test('Einzelfeld erzeugt ausschließlich seine benötigten Eltern', () => {
      const { template, selection } = setup('a:\n  b:\n    c: 2\n    d: 3\nz: 4\n');
      select(selection, ['a', 'b', 'c']);
      equal(exportValue(template, selection), { a: { b: { c: 2 } } });
    });
    test('Gruppenauswahl und Zwischenzustand', () => {
      const { selection } = setup('a:\n  b: true\n  c: false\n');
      select(selection, ['a']);
      const group = field(selection.root, ['a']);
      equal(c.getStatus(group, selection).selected, true);
      select(selection, ['a', 'b'], false);
      equal(c.getStatus(group, selection).partial, true);
      select(selection, ['a'], false);
      equal(c.getStatus(group, selection).count, 0);
    });
    test('Ausgewähltes false wird exportiert', () => {
      const { template, selection } = setup('flag: true\n');
      const node = field(selection.root, ['flag']);
      c.setValue(selection, node.id, false, 'boolean');
      select(selection, ['flag']);
      equal(exportValue(template, selection), { flag: false });
    });
    test('Leerer Text, null, leere Listen und Objekte bleiben verschieden', () => {
      const { template, selection } = setup('text: ""\nnone: null\nitems: []\ngroup: {}\n');
      c.setSelected(selection, selection.root.id, true);
      equal(exportValue(template, selection), { text: '', none: null, items: [], group: {} });
    });
    test('Typwechsel verändert den exportierten YAML-Typ', () => {
      const { template, selection } = setup('value: "true"\n');
      const node = field(selection.root, ['value']);
      c.setValue(selection, node.id, 'true', 'boolean');
      select(selection, ['value']);
      equal(exportValue(template, selection).value, true);
      c.setValue(selection, node.id, 0, 'number');
      equal(exportValue(template, selection).value, 0);
      c.setValue(selection, node.id, null, 'null');
      equal(exportValue(template, selection).value, null);
    });
    test('Ungültige Zahl blockiert nur ausgewählte Felder', () => {
      const { template, selection } = setup('value: 2\nother: x\n');
      const node = field(selection.root, ['value']);
      c.setValue(selection, node.id, '2x');
      select(selection, ['value']);
      throws(() => c.serializeSelection(template, selection), 'Zahl');
      select(selection, ['value'], false);
      select(selection, ['other']);
      equal(exportValue(template, selection), { other: 'x' });
      c.setValue(selection, node.id, '-1.25e2');
      select(selection, ['value']);
      equal(exportValue(template, selection).value, -125);
    });
    test('Listen: auswählen, bearbeiten, hinzufügen und entfernen', () => {
      const { template, selection } = setup('items:\n  - a\n  - b\n');
      select(selection, ['items', 1]);
      const group = field(selection.root, ['items']);
      const added = c.addItem(selection, group.id, 'string');
      c.setValue(selection, added.id, 'c');
      equal(exportValue(template, selection), { items: ['b', 'c'] });
      c.removeItem(selection, group.id, group.children[0].id);
      equal(group.children[0].path, ['items', 0]);
      equal(exportValue(template, selection), { items: ['b', 'c'] });
    });
    test('Objektlisten: neues Element übernimmt Struktur der Vorlage', () => {
      const { template, selection } = setup('items:\n  - name: A\n    enabled: false\n');
      const group = field(selection.root, ['items']);
      const added = c.addItem(selection, group.id, 'example');
      c.setValue(selection, added.children[0].id, 'B');
      equal(exportValue(template, selection), { items: [{ name: 'B', enabled: false }] });
      equal(template.root.children[0].children.length, 1);
    });
    test('Verschachtelte Listen und Objekte werden rekursiv exportiert', () => {
      const { template, selection } = setup('items: [[1, 2], {nested: [false, null]}]\n');
      c.setSelected(selection, selection.root.id, true);
      equal(exportValue(template, selection), { items: [[1, 2], { nested: [false, null] }] });
    });
    test('Leere Objektliste kann neue Felder erhalten', () => {
      const { template, selection } = setup('items: []\n');
      const list = field(selection.root, ['items']);
      const object = c.addItem(selection, list.id, 'object');
      const child = c.addItem(selection, object.id, 'string', 'name');
      c.setValue(selection, child.id, 'Neu');
      equal(exportValue(template, selection), { items: [{ name: 'Neu' }] });
      throws(() => c.addItem(selection, object.id, 'number', 'name'), 'existiert');
    });
    test('Abwählen behält bearbeitete Werte', () => {
      const { template, selection } = setup('name: alt\n');
      const node = field(selection.root, ['name']);
      c.setValue(selection, node.id, 'neu');
      select(selection, ['name']);
      select(selection, ['name'], false);
      select(selection, ['name']);
      equal(exportValue(template, selection), { name: 'neu' });
    });
    test('Zurücksetzen stellt Vorlage und leere Auswahl wieder her', () => {
      const { template, selection } = setup('items: [a]\n');
      c.addItem(selection, field(selection.root, ['items']).id, 'string');
      const reset = c.createInitialSelection(template);
      equal(reset.root.children[0].children.length, 1);
      equal(c.serializeSelection(template, reset), '');
    });
    test('Alle Kommentararten bleiben unveränderter Hilfetext', () => {
      const help = 'hint: explanation\n"hint": quoted option\nExamples:\n  - first\n  - second\nTODO: change this\nbroken: [\nvalue: color (default), monochrome';
      const source = help.split('\n').map(line => '  # ' + line).join('\n');
      const { template, selection } = setup('app:\n' + source + '\n  value: active\n');
      equal(field(template.root, ['app']).children.map(node => node.key), ['value']);
      equal(field(template.root, ['app', 'value']).hints, [help]);
      c.setSelected(selection, selection.root.id, true);
      equal(exportValue(template, selection), { app: { value: 'active' } });
    });
    test('Kommentarblöcke erhalten Leerzeilen, Einrückung und Wiederholungen', () => {
      const { template } = setup('# heading\n#\n#   indented\n\n# repeated\n# repeated\nvalue: x\n');
      equal(field(template.root, ['value']).hints, ['heading\n\n  indented\n\nrepeated\nrepeated']);
    });
    test('Kommentare nach Feldern und ohne Nachbarfeld bleiben sichtbar', () => {
      const { template, selection } = setup('app:\n  active: true\n  # extra:\n  #   names: [a, b]\nother:\n  # enabled: false\n');
      equal(field(template.root, ['app', 'active']).hints, ['extra:\n  names: [a, b]']);
      equal(field(template.root, ['other']).hints, ['enabled: false']);
      c.setSelected(selection, selection.root.id, true);
      equal(exportValue(template, selection), { app: { active: true }, other: null });
      equal(setup('{} # document help\n').template.root.hints, ['document help']);
    });
    test('Inline-Kommentare gehören zum Feld und werden nicht exportiert', () => {
      const { template, selection } = setup('name: value # inline\nitems: [a, b] # list help\n');
      equal(field(template.root, ['name']).hints, ['inline']);
      equal(field(template.root, ['items']).hints, ['list help']);
      equal(field(setup('text: | # header without newline').template.root, ['text']).hints, ['header without newline']);
      c.setSelected(selection, selection.root.id, true);
      equal(exportValue(template, selection), { name: 'value', items: ['a', 'b'] });
    });
    test('Rauten in Texten und Schlüsseln sind keine Kommentare', () => {
      const { template, selection } = setup(`"# key": "text # literal" # real help\nurl: https://example.org/#fragment\nsingle: 'it''s # text' # single help\nmultiline: "first\n  # quoted text"\nscript: | # script help\n  # literal code\n  echo hello\n`);
      equal(field(template.root, ['# key']).hints, ['real help']);
      equal(field(template.root, ['url']).hints, []);
      equal(field(template.root, ['single']).hints, ['single help']);
      equal(field(template.root, ['multiline']).hints, []);
      equal(field(template.root, ['script']).hints, ['script help']);
      c.setSelected(selection, selection.root.id, true);
      equal(exportValue(template, selection), yaml.parse(`"# key": "text # literal"\nurl: https://example.org/#fragment\nsingle: 'it''s # text'\nmultiline: "first\n  # quoted text"\nscript: |\n  # literal code\n  echo hello\n`));
    });
    test('Hilfetext bleibt nach Import und Zurücksetzen erhalten', () => {
      const template = c.parseTemplate('# group help\napp:\n  # field help\n  value: original\n');
      const selection = c.importExport(template, 'app: {value: changed}\n');
      equal(field(selection.root, ['app']).hints, ['group help']);
      equal(field(selection.root, ['app', 'value']).hints, ['field help']);
      equal(field(c.createInitialSelection(template).root, ['app', 'value']).hints, ['field help']);
      equal(exportValue(template, selection), { app: { value: 'changed' } });
    });
    test('Numerische Textschlüssel behalten ihre Quellreihenfolge', () => {
      const { template, selection } = setup('"10": x\n"2": y\n"1": z\n');
      c.setSelected(selection, selection.root.id, true);
      const text = c.serializeSelection(template, selection);
      assert(text.indexOf('"10"') < text.indexOf('"2"') && text.indexOf('"2"') < text.indexOf('"1"'), text);
    });
    test('Mehrzeilige Texte behalten ihre abschließenden Zeilenumbrüche', () => {
      ['', 'hello', 'hello\nworld', 'hello\n', 'hello\n\n', '  indented\nnext'].forEach(text => {
        const { template, selection } = setup('value: x\n');
        c.setValue(selection, field(selection.root, ['value']).id, text);
        select(selection, ['value']);
        equal(exportValue(template, selection).value, text);
      });
    });
    test('Sonderzeichen und mehrzeilige Schlüssel bleiben erhalten', () => {
      const { template, selection } = setup('"a.b": x\n"key: value": "false"\n"line\\nbreak": 2\n');
      c.setSelected(selection, selection.root.id, true);
      equal(exportValue(template, selection), { 'a.b': 'x', 'key: value': 'false', 'line\nbreak': 2 });
      equal(c.formatPath(['a.b', 0]), '["a.b"][0]');
    });
    test('Spezielle Objektschlüssel verändern keine Prototypen', () => {
      const { template, selection } = setup('__proto__:\n  pollution: true\nconstructor: x\n');
      c.setSelected(selection, selection.root.id, true);
      const actual = exportValue(template, selection);
      assert(Object.prototype.hasOwnProperty.call(actual, '__proto__'));
      equal(actual.__proto__.pollution, true);
      equal({}.pollution, undefined);
    });
    test('CRLF und UTF-8-BOM werden erkannt', () => {
      const { template, selection } = setup('\uFEFFapp:\r\n  # extra: true\r\n  name: Grüße\r\n');
      select(selection, ['app']);
      equal(exportValue(template, selection), { app: { name: 'Grüße' } });
    });
    test('Ungültiges YAML und doppelte aktive Schlüssel werden abgelehnt', () => {
      throws(() => c.parseTemplate('a: [\n'), 'Zeile');
      throws(() => c.parseTemplate('a: 1\na: 2\n'), 'Zeile');
    });
    test('Mehrere Dokumente und andere Wurzeltypen werden abgelehnt', () => {
      throws(() => c.parseTemplate('a: 1\n---\nb: 2\n'));
      throws(() => c.parseTemplate('- a\n- b\n'), 'Wurzel');
      throws(() => c.parseTemplate('text\n'), 'Wurzel');
    });
    test('Komplexe Schlüssel, Aliase und benutzerdefinierte Tags werden abgelehnt', () => {
      throws(() => c.parseTemplate('? [a, b]\n: x\n'), 'Schlüssel');
      throws(() => c.parseTemplate('a: &anchor [1]\nb: *anchor\n'), 'Anker');
      throws(() => c.parseTemplate('a: !custom x\n'), 'YAML');
    });
    test('Aliasähnliche Texte sind weiterhin normale Texte', () => {
      const { template, selection } = setup('a: "*literal"\nb: "!tag"\nc: "&anchor"\n');
      c.setSelected(selection, selection.root.id, true);
      equal(exportValue(template, selection), { a: '*literal', b: '!tag', c: '&anchor' });
    });
    test('Nicht-Core-Tags und verlustbehaftete Zahlen werden abgelehnt', () => {
      ['a: !!timestamp 2020-01-01\n', 'a: !!binary aGVsbG8=\n'].forEach(text => throws(() => c.parseTemplate(text), 'YAML'));
      ['9007199254740992', '-9007199254740992', '0x20000000000000', '.inf', '.nan', '1e999'].forEach(value => throws(() => c.parseTemplate('a: ' + value + '\n'), 'Zahl'));
      const { template, selection } = setup('max: 9007199254740991\nmin: -9007199254740991\n');
      c.setSelected(selection, selection.root.id, true);
      equal(exportValue(template, selection), { max: Number.MAX_SAFE_INTEGER, min: Number.MIN_SAFE_INTEGER });
    });
    test('Größen-, Tiefen- und Knotenlimits bleiben erhalten', () => {
      throws(() => c.parseTemplate('a: ' + 'x'.repeat(5 * 1024 * 1024)), '5 MB');
      throws(() => c.parseTemplate('a: ' + '['.repeat(102) + '0' + ']'.repeat(102)), 'tief');
      throws(() => c.parseTemplate('a: [' + Array(30001).fill('0').join(',') + ']'), 'groß');
    });
    test('Ungültige neue Vorlage verändert einen vorhandenen Arbeitsstand nicht', () => {
      const { template, selection } = setup('a: 1\n');
      select(selection, ['a']);
      throws(() => c.parseTemplate('broken: [\n'));
      equal(exportValue(template, selection), { a: 1 });
    });
    test('IDs bleiben nach Listenergänzungen eindeutig', () => {
      const { selection } = setup('a: []\n# b:\n#   c: true\n');
      c.addItem(selection, field(selection.root, ['a']).id, 'object');
      const ids = [];
      c.walk(selection.root, node => ids.push(node.id));
      equal(new Set(ids).size, ids.length);
    });
    test('Exportimport übernimmt aktive Werte und erhält zusätzliche Felder', () => {
      const template = c.parseTemplate('app:\n  enabled: true\n  port: 80\n  # extra: example\nunused: 1\n');
      const selection = c.importExport(template, 'app:\n  enabled: false\n  extra: null\ncustom:\n  value: 0\n');
      equal(exportValue(template, selection), {app: {enabled: false, extra: null}, custom: {value: 0}});
      equal(c.getStatus(field(selection.root, ['app', 'enabled']), selection).selected, true);
      equal(c.getStatus(field(selection.root, ['unused']), selection).selected, false);
      select(selection, ['app', 'port']);
      equal(exportValue(template, selection).app.port, 80);
      equal(exportValue(template, selection).custom.value, 0);
    });
    test('Exportlisten und Strukturwechsel bleiben unverändert erhalten', () => {
      const template = c.parseTemplate('list: [a, b, c]\nobj: {a: 1}\nvalue: text\n');
      const selection = c.importExport(template, 'list: [false, {x: 2}]\nobj: {}\nvalue: [1]\nempty: []\n');
      equal(exportValue(template, selection), {list: [false, {x: 2}], obj: {}, value: [1], empty: []});
      const ids = [];
      c.walk(selection.root, node => ids.push(node.id));
      equal(new Set(ids).size, ids.length);
    });
    test('Exportkommentare sind keine aktiven Optionen; fehlerhafter Import bleibt isoliert', () => {
      const template = c.parseTemplate('a: 1\nb: 2\n');
      const selection = c.importExport(template, 'a: "1"\n# b: 9\n');
      equal(exportValue(template, selection), {a: '1'});
      throws(() => c.importExport(template, 'a: [\n'));
      throws(() => c.importExport(template, '[1, 2]'));
      throws(() => c.importExport(template, 'a: 1\na: 2\n'));
      equal(exportValue(template, selection), {a: '1'});
      equal(exportValue(template, c.createInitialSelection(template)), undefined);
    });
    return { results, passed: results.filter(result => result.passed).length, failed: results.filter(result => !result.passed).length };
  }
  function validateSource(text) {
    const results = [];
    let template;
    try {
      template = c.parseTemplate(text);
      results.push({ name: 'Eigene Vorlage: YAML erfolgreich eingelesen', passed: true });
    } catch (error) {
      return { results: [{ name: 'Eigene Vorlage: YAML erfolgreich eingelesen', passed: false, error: error.message }], passed: 0, failed: 1 };
    }
    function test(name, action) {
      try { action(); results.push({ name, passed: true }); }
      catch (error) { results.push({ name, passed: false, error: error.message }); }
    }
    function canonical(value) {
      if (Array.isArray(value)) return value.map(canonical);
      if (value && typeof value === 'object') {
        const result = Object.create(null);
        Object.keys(value).sort().forEach(key => { result[key] = canonical(value[key]); });
        return result;
      }
      return value;
    }
    test('Eigene Vorlage: neue Auswahl ist leer', () => {
      equal(c.serializeSelection(template, c.createInitialSelection(template)), '');
    });
    test('Eigene Vorlage: aktive Werte bleiben beim Import und Export erhalten', () => {
      const selection = c.importExport(template, text);
      const output = c.serializeSelection(template, selection);
      const actual = output ? yaml.parse(output) : {};
      const expected = yaml.parse(text);
      assert(JSON.stringify(canonical(actual)) === JSON.stringify(canonical(expected)), 'Aktive Schlüssel, Werte oder Typen wurden beim Import/Export verändert.');
    });
    return { results, passed: results.filter(result => result.passed).length, failed: results.filter(result => !result.passed).length };
  }
  global.YamlStudioTests = Object.freeze({ run, validateSource });
})(globalThis);
