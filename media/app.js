(function () {
  'use strict';
  const core = globalThis.YamlStudio;
  const vscode = acquireVsCodeApi();
  let requestId = 0;
  const requests = new Map();
  function request(type, payload = {}) {
    const id = ++requestId;
    return new Promise((resolve, reject) => {
      requests.set(id, { resolve, reject });
      vscode.postMessage({ type, id, ...payload });
    });
  }
  function asFile(file) {
    return { name: file.name, size: file.size, text: async () => file.text };
  }
  window.addEventListener('message', event => {
    const message = event.data;
    if (message?.type === 'response') {
      const pending = requests.get(message.id);
      if (!pending) return;
      requests.delete(message.id);
      if (message.error) pending.reject(new Error(message.error));
      else pending.resolve(message.data);
    } else if (message?.type === 'template' && message.file) loadFile(asFile(message.file));
  });
  const $ = id => document.getElementById(id);
  const typeLabels = { string: 'Text', number: 'Zahl', boolean: 'Boolean', null: 'null', object: 'Objekt', array: 'Liste', example: 'Wie Vorlage' };
  let template = null;
  let selection = null;
  let importedText = null;
  let output = '';
  let loadVersion = 0;
  let toastTimer;
  let selectionFilter = 'all';
  const openGroups = new Map();
  const nodeRows = new Map();
  const searchTexts = new Map();

  function element(tag, className, text) {
    const result = document.createElement(tag);
    if (className) result.className = className;
    if (text !== undefined) result.textContent = text;
    return result;
  }

  function button(text, className, action) {
    const result = element('button', className, text);
    result.type = 'button';
    result.addEventListener('click', action);
    return result;
  }

  function toast(message) {
    clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').hidden = false;
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3000);
  }

  function showError(error) {
    $('message').textContent = error.message || String(error);
    $('message').hidden = false;
  }

  function typeSelect(types, value, label) {
    const select = element('select', 'type-select');
    select.setAttribute('aria-label', label);
    types.forEach(type => {
      const option = element('option', '', typeLabels[type]);
      option.value = type;
      select.append(option);
    });
    select.value = value;
    return select;
  }

  function displayKey(node) {
    return typeof node.key === 'number' ? 'Eintrag ' + (node.key + 1) : node.key;
  }

  function selectionCheckbox(node) {
    const checkbox = element('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.selectId = node.id;
    checkbox.setAttribute('aria-label', core.formatPath(node.path) + ' für die Konfiguration auswählen');
    checkbox.addEventListener('click', event => { event.stopPropagation(); });
    checkbox.addEventListener('keydown', event => { event.stopPropagation(); });
    checkbox.addEventListener('change', () => {
      core.setSelected(selection, node.id, checkbox.checked);
      updateSelection();
      updatePreview();
    });
    return checkbox;
  }

  function removeButton(node, parent) {
    if (!parent || (parent.type !== 'array' && node.source !== 'new')) return null;
    const remove = button('×', 'remove-button', event => {
      event.preventDefault();
      event.stopPropagation();
      core.removeItem(selection, parent.id, node.id);
      renderFields();
      updatePreview();
    });
    remove.title = 'Eintrag entfernen';
    remove.setAttribute('aria-label', core.formatPath(node.path) + ' entfernen');
    return remove;
  }

  function addRow(node) {
    const row = element('div', 'add-row');
    let keyInput;
    if (node.type === 'object') {
      keyInput = element('input');
      keyInput.placeholder = 'Neuer Feldname';
      keyInput.setAttribute('aria-label', 'Neuer Feldname in ' + core.formatPath(node.path));
      row.append(keyInput);
    }
    const types = node.type === 'array' ? ['example', 'string', 'number', 'boolean', 'null', 'object', 'array'] : ['string', 'number', 'boolean', 'null', 'object', 'array'];
    const select = typeSelect(types, types[0], 'Typ des neuen Eintrags');
    row.append(select);
    const add = button(node.type === 'array' ? '+ Eintrag hinzufügen' : '+ Feld hinzufügen', '', () => {
      try {
        const child = core.addItem(selection, node.id, select.value, keyInput ? keyInput.value.trim() : undefined);
        openGroups.set(node.id, true);
        if (child.children.length) openGroups.set(child.id, true);
        renderFields();
        updatePreview();
        const added = document.querySelector('[data-node-id="' + child.id + '"]');
        if (added) {
          added.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          const input = added.querySelector('.value-input, .boolean-control input, summary');
          if (input) input.focus();
        }
      } catch (error) { toast(error.message); }
    });
    row.append(add);
    return row;
  }

  function renderGroup(node, parent, depth) {
    const details = element('details', 'group');
    details.dataset.nodeId = node.id;
    details.open = openGroups.has(node.id) ? openGroups.get(node.id) : depth < 1;
    details.addEventListener('toggle', () => {
      // Ignore toggle events from detached nodes after a rerender.
      if (details.isConnected && !$('search').value.trim() && selectionFilter === 'all') openGroups.set(node.id, details.open);
    });
    const summary = element('summary');
    summary.append(element('span', 'chevron'), selectionCheckbox(node), element('span', 'group-name', displayKey(node)));
    const meta = element('span', 'group-meta');
    meta.dataset.groupCount = node.id;
    summary.append(meta);
    const remove = removeButton(node, parent);
    if (remove) summary.append(remove);
    const content = element('div', 'group-content');
    if (node.hints.length) content.append(element('p', 'group-hint', node.hints.join('\n\n')));
    node.children.forEach(child => content.append(renderNode(child, node, depth + 1)));
    if (node.type === 'array' || node.source === 'new') content.append(addRow(node));
    details.append(summary, content);
    return details;
  }

  function renderField(node, parent) {
    const field = selection.fields[node.id];
    const row = element('div', 'field');
    row.dataset.nodeId = node.id;
    const top = element('div', 'field-top');
    const label = element('div', 'field-label');
    const key = element('label', 'field-key', displayKey(node));
    key.htmlFor = 'value-' + node.id;
    label.append(key, element('div', 'field-path', core.formatPath(node.path)));
    top.append(selectionCheckbox(node), label);
    const remove = removeButton(node, parent);
    if (remove) top.append(remove);
    row.append(top);
    const controls = element('div', 'field-controls');
    let valueInput;
    if (field.type === 'boolean') {
      const booleanLabel = element('label', 'boolean-control');
      valueInput = element('input');
      valueInput.type = 'checkbox';
      valueInput.checked = field.value === true;
      valueInput.id = 'value-' + node.id;
      valueInput.setAttribute('aria-label', core.formatPath(node.path) + ' Wert');
      const valueText = element('span', '', String(valueInput.checked));
      booleanLabel.append(valueInput, valueText);
      valueInput.addEventListener('change', () => {
        core.setValue(selection, node.id, valueInput.checked);
        valueText.textContent = String(valueInput.checked);
        updatePreview();
      });
      controls.append(booleanLabel);
    } else if (field.type === 'null') {
      controls.append(element('span', 'null-value', 'null · explizit leer'));
    } else {
      valueInput = element(field.type === 'string' ? 'textarea' : 'input', 'value-input');
      if (field.type === 'string') {
        valueInput.rows = String(field.value).includes('\n') ? 3 : 1;
        valueInput.style.minHeight = '36px';
      } else {
        valueInput.type = 'text';
        valueInput.inputMode = 'decimal';
      }
      valueInput.value = field.value;
      valueInput.spellcheck = false;
      valueInput.id = 'value-' + node.id;
      valueInput.setAttribute('aria-label', core.formatPath(node.path) + ' Wert');
      valueInput.setAttribute('aria-invalid', String(!!field.error));
      valueInput.setAttribute('aria-describedby', 'error-' + node.id);
      valueInput.addEventListener('input', () => {
        const current = core.setValue(selection, node.id, valueInput.value);
        valueInput.setAttribute('aria-invalid', String(!!current.error));
        errorText.textContent = current.error;
        errorText.hidden = !current.error;
        updatePreview();
      });
      controls.append(valueInput);
    }
    const type = typeSelect(['string', 'number', 'boolean', 'null'], field.type, core.formatPath(node.path) + ' Werttyp');
    if (field.type === 'null') type.id = 'value-' + node.id;
    type.addEventListener('change', () => {
      core.setValue(selection, node.id, field.value, type.value);
      renderFields();
      updatePreview();
      const nextInput = document.getElementById('value-' + node.id);
      if (nextInput) nextInput.focus();
    });
    controls.append(type);
    row.append(controls);
    if (node.hints.length) row.append(element('p', 'field-hint', node.hints.join('\n\n')));
    const errorText = element('p', 'field-error', field.error);
    errorText.id = 'error-' + node.id;
    errorText.hidden = !field.error;
    row.append(errorText);
    return row;
  }

  function renderNode(node, parent, depth) {
    return node.type === 'object' || node.type === 'array' ? renderGroup(node, parent, depth) : renderField(node, parent);
  }

  function renderFields(preserveOpenGroups = true) {
    // Preserve the current open state before replacing DOM nodes.
    if (preserveOpenGroups && !$('search').value.trim() && selectionFilter === 'all') document.querySelectorAll('details.group').forEach(group => openGroups.set(group.dataset.nodeId, group.open));
    const fragment = document.createDocumentFragment();
    if (selection.root.hints.length) fragment.append(element('p', 'group-hint', selection.root.hints.join('\n\n')));
    selection.root.children.forEach(node => fragment.append(renderNode(node, selection.root, 0)));
    if (!selection.root.children.length) {
      fragment.append(element('p', 'group-hint', 'Die Vorlage enthält noch keine Felder.'));
      fragment.append(addRow(selection.root));
    }
    $('fields').replaceChildren(fragment);
    nodeRows.clear();
    searchTexts.clear();
    $('fields').querySelectorAll('[data-node-id]').forEach(row => nodeRows.set(row.dataset.nodeId, row));
    core.walk(selection.root, node => searchTexts.set(node.id, (String(node.key) + ' ' + core.formatPath(node.path) + ' ' + node.hints.join(' ')).toLocaleLowerCase('de')));
    updateSelection();
  }

  function updateSelection() {
    if (!selection) return;
    const statuses = new Map();
    function collectStatus(node) {
      let status;
      if (node.children.length) {
        const children = node.children.map(collectStatus);
        const selected = children.every(child => child.selected);
        status = { selected, partial: !selected && children.some(child => child.selected || child.partial), count: children.reduce((sum, child) => sum + child.count, 0), total: children.reduce((sum, child) => sum + child.total, 0) };
      } else status = core.getStatus(node, selection);
      statuses.set(node.id, status);
      return status;
    }
    collectStatus(selection.root);
    document.querySelectorAll('[data-select-id]').forEach(checkbox => {
      const status = statuses.get(checkbox.dataset.selectId);
      checkbox.checked = status.selected;
      checkbox.indeterminate = status.partial;
    });
    document.querySelectorAll('[data-group-count]').forEach(label => {
      const status = statuses.get(label.dataset.groupCount);
      label.textContent = status.count + ' / ' + status.total;
    });
    document.querySelectorAll('.field[data-node-id]').forEach(row => row.classList.toggle('selected', statuses.get(row.dataset.nodeId).selected));
    const count = statuses.get(selection.root.id).count;
    $('selection-count').textContent = count + ' ausgewählt';
    applySearch();
  }

  function effectiveFilename() {
    const name = $('filename').value.trim();
    if (!name || /[<>:"/\\|?*\x00-\x1f]/.test(name)) throw new Error('Bitte einen gültigen Dateinamen ohne Pfad eingeben.');
    return /\.ya?ml$/i.test(name) ? name : name + '.yml';
  }

  function updatePreview() {
    let error = '';
    output = '';
    try { output = core.serializeSelection(template, selection); }
    catch (failure) { error = failure.message; }
    $('preview').textContent = error ? '# Bitte die markierten Eingaben korrigieren.' : output || '# Wähle links die ersten Optionen aus.';
    try { $('preview-filename').textContent = effectiveFilename(); }
    catch (failure) { if (!error) error = failure.message; }
    $('filename').setAttribute('aria-invalid', String(!isValidFilename()));
    $('export-error').textContent = error;
    $('export-error').hidden = !error;
    $('download-label').textContent = 'Speichern unter …';
    $('download').disabled = !output || !!error;
    $('save-hint').textContent = importedText === null ? 'Nur ausgewählte Optionen werden exportiert.' : 'Wähle den Speicherort für deine aktualisierte Konfiguration.';
    $('copy').disabled = !output;
  }

  function isValidFilename() {
    try { effectiveFilename(); return true; } catch (_) { return false; }
  }

  function applySearch() {
    if (!selection) return;
    const query = $('search').value.trim().toLocaleLowerCase('de');
    function filter(node, ancestorMatch) {
      const ownMatch = !query || ancestorMatch || searchTexts.get(node.id).includes(query);
      let childMatch = false;
      node.children.forEach(child => { if (filter(child, ownMatch)) childMatch = true; });
      const selected = selection.fields[node.id].selected;
      const selectionMatch = selectionFilter === 'all' || (selectionFilter === 'selected' ? selected : !selected);
      const visible = node.children.length ? childMatch : ownMatch && selectionMatch;
      const row = nodeRows.get(node.id);
      if (row) {
        row.hidden = !visible;
        if (row.tagName === 'DETAILS') row.open = query || selectionFilter !== 'all' ? visible : (openGroups.has(node.id) ? openGroups.get(node.id) : node.path.length < 2);
      }
      return visible;
    }
    let any = false;
    selection.root.children.forEach(node => { if (filter(node, false)) any = true; });
    $('no-results').hidden = any || (!query && selectionFilter === 'all');
  }

  document.querySelectorAll('[data-selection-filter]').forEach(control => {
    control.addEventListener('click', () => {
      if (selectionFilter === 'all' && !$('search').value.trim()) {
        document.querySelectorAll('details.group').forEach(group => openGroups.set(group.dataset.nodeId, group.open));
      }
      selectionFilter = control.dataset.selectionFilter;
      document.querySelectorAll('[data-selection-filter]').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.selectionFilter === selectionFilter));
      });
      applySearch();
    });
  });

  async function loadFile(file) {
    if (!file) return;
    const version = ++loadVersion;
    try {
      if (!/\.ya?ml$/i.test(file.name)) throw new Error('Bitte eine Datei mit der Endung .yml oder .yaml wählen.');
      if (file.size > 5 * 1024 * 1024) throw new Error('Die Vorlage darf höchstens 5 MB groß sein.');
      const text = await file.text();
      if (version !== loadVersion) return;
      const nextTemplate = core.parseTemplate(text);
      const nextSelection = core.createInitialSelection(nextTemplate);
      importedText = null;
      $('import-name').textContent = '';
      template = nextTemplate;
      selection = nextSelection;
      openGroups.clear();
      $('search').value = '';
      $('message').hidden = true;
      $('drop-zone').hidden = true;
      $('workspace').hidden = false;
      document.body.classList.add('has-template');
      $('source-name').textContent = file.name;
      const status = core.getStatus(selection.root, selection);
      $('source-meta').textContent = status.total + ' Optionen erkannt';
      renderFields(false);
      updatePreview();
      vscode.postMessage({ type: 'templateLoaded' });
    } catch (error) {
      if (version === loadVersion) showError(error);
    }
  }

  async function loadExport(file) {
    if (!file || !template) return;
    const version = ++loadVersion;
    try {
      if (!/\.ya?ml$/i.test(file.name)) throw new Error('Bitte eine YAML-Konfiguration (.yml oder .yaml) wählen.');
      if (file.size > 5 * 1024 * 1024) throw new Error('Die Konfiguration darf höchstens 5 MB groß sein.');
      const text = await file.text();
      if (version !== loadVersion) return;
      const nextSelection = core.importExport(template, text);
      selection = nextSelection;
      importedText = text;
      $('filename').value = file.name;
      $('import-name').textContent = 'Basis: ' + file.name;
      $('message').hidden = true;
      $('search').value = '';
      openGroups.clear();
      renderFields(false);
      updatePreview();
      toast('Konfiguration geladen. Vorhandene Optionen und Werte übernommen.');
    } catch (error) { if (version === loadVersion) showError(error); }
  }

  async function pickFile(type) {
    try {
      const file = await request(type);
      if (file) await (type === 'openTemplate' ? loadFile : loadExport)(asFile(file));
    } catch (error) { showError(error); }
  }
  $('load-template').addEventListener('click', () => pickFile('openTemplate'));
  $('load-template-start').addEventListener('click', () => pickFile('openTemplate'));
  $('start-over').addEventListener('click', async () => {
    $('start-over').disabled = true;
    try {
      const result = await request('resetSession');
      if (!result?.reset) return;
      ++loadVersion;
      template = null;
      selection = null;
      importedText = null;
      output = '';
      selectionFilter = 'all';
      openGroups.clear();
      nodeRows.clear();
      searchTexts.clear();
      clearTimeout(toastTimer);
      $('toast').hidden = true;
      $('message').hidden = true;
      $('fields').replaceChildren();
      $('workspace').hidden = true;
      $('drop-zone').hidden = false;
      document.body.classList.remove('has-template');
      $('search').value = '';
      $('filename').value = 'config.yml';
      $('filename').setAttribute('aria-invalid', 'false');
      $('preview-filename').textContent = 'config.yml';
      $('preview').textContent = '# Wähle links die ersten Optionen aus.';
      $('export-error').hidden = true;
      $('export-error').textContent = '';
      $('download').disabled = true;
      $('copy').disabled = true;
      $('selection-count').textContent = '0 ausgewählt';
      for (const id of ['source-name', 'source-meta', 'import-name']) $(id).textContent = '';
      document.querySelectorAll('[data-selection-filter]').forEach(control => {
        control.setAttribute('aria-pressed', String(control.dataset.selectionFilter === 'all'));
      });
      window.scrollTo(0, 0);
      $('load-template-start').focus();
    } catch (error) { showError(error); }
    finally { $('start-over').disabled = false; }
  });
  $('import-export').addEventListener('click', () => pickFile('openConfig'));
  document.addEventListener('dragover', event => event.preventDefault());
  document.addEventListener('drop', event => { event.preventDefault(); toast('Bitte „Vorlage laden“ verwenden.'); });
  $('search').addEventListener('input', applySearch);
  $('filename').addEventListener('input', () => { if (selection) updatePreview(); });
  $('select-all').addEventListener('click', () => { core.setSelected(selection, selection.root.id, true); updateSelection(); updatePreview(); });
  $('select-none').addEventListener('click', () => { core.setSelected(selection, selection.root.id, false); updateSelection(); updatePreview(); });
  $('reset').addEventListener('click', () => { selection = importedText === null ? core.createInitialSelection(template) : core.importExport(template, importedText); $('search').value = ''; renderFields(); updatePreview(); toast('Änderungen zurückgesetzt.'); });
  $('expand-all').addEventListener('click', () => { document.querySelectorAll('details.group').forEach(group => { openGroups.set(group.dataset.nodeId, true); group.open = true; }); });
  $('collapse-all').addEventListener('click', () => { document.querySelectorAll('details.group').forEach(group => { openGroups.set(group.dataset.nodeId, false); group.open = false; }); });
  $('download').addEventListener('click', async () => {
    if (!output || $('download').disabled) return;
    const text = output;
    $('download').disabled = true;
    try {
      const result = await request('save', { text, filename: effectiveFilename() });
      if (result?.saved) {
        $('message').hidden = true;
        toast('YAML gespeichert: ' + result.name);
      }
    } catch (error) { showError(error); }
    finally { if (selection) updatePreview(); }
  });
  $('copy').addEventListener('click', async () => {
    if (!output) return;
    try {
      const result = await request('copy', { text: output });
      if (result?.copied) toast('YAML in die Zwischenablage kopiert.');
    } catch (error) { showError(error); }
  });
  request('ready').catch(showError);
})();
