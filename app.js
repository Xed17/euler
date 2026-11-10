(function initializeEulerHeun(root) {
  'use strict';

  const FUNCTION_TABLE = Object.freeze({
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    exp: Math.exp,
    ln: Math.log,
    sqrt: Math.sqrt,
    abs: Math.abs,
  });

  function tokenize(source) {
    const text = String(source ?? '');
    const tokens = [];
    const pattern = /\s*(?:(\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|([A-Za-z_][A-Za-z0-9_]*)|([()+\-*/^]))/iy;
    let position = 0;

    while (position < text.length) {
      pattern.lastIndex = position;
      const match = pattern.exec(text);
      if (!match) {
        if (!text.slice(position).trim()) break;
        throw new Error(`Símbolo no permitido en la posición ${position + 1}.`);
      }
      const token = match[1] !== undefined
        ? { type: 'number', value: Number(match[0].trim()) }
        : match[2] !== undefined
          ? { type: 'name', value: match[2].toLowerCase() }
          : { type: 'operator', value: match[3] };
      tokens.push(token);
      position = pattern.lastIndex;
    }

    return tokens;
  }

  function compileExpression(source) {
    if (typeof source !== 'string' || !source.trim()) {
      throw new Error('Escribe una expresión matemática.');
    }

    const tokens = tokenize(source);
    let cursor = 0;
    const usedVariables = new Set();
    const current = () => tokens[cursor];
    const accept = (value) => {
      if (current()?.value !== value) return false;
      cursor += 1;
      return true;
    };
    const expect = (value) => {
      if (!accept(value)) throw new Error(`Se esperaba «${value}» en la fórmula.`);
    };

    function parseAdditive() {
      let node = parseMultiplicative();
      while (current()?.value === '+' || current()?.value === '-') {
        const operator = current().value;
        cursor += 1;
        node = { type: 'binary', operator, left: node, right: parseMultiplicative() };
      }
      return node;
    }

    function parseMultiplicative() {
      let node = parseUnary();
      while (current()?.value === '*' || current()?.value === '/') {
        const operator = current().value;
        cursor += 1;
        node = { type: 'binary', operator, left: node, right: parseUnary() };
      }
      return node;
    }

    function parseUnary() {
      if (accept('+')) return { type: 'unary', operator: '+', value: parseUnary() };
      if (accept('-')) return { type: 'unary', operator: '-', value: parseUnary() };
      return parsePower();
    }

    function parsePower() {
      const base = parsePrimary();
      if (accept('^')) return { type: 'binary', operator: '^', left: base, right: parseUnary() };
      return base;
    }

    function parsePrimary() {
      const token = current();
      if (!token) throw new Error('La fórmula termina antes de lo esperado.');

      if (token.type === 'number') {
        cursor += 1;
        return { type: 'number', value: token.value };
      }

      if (token.type === 'name') {
        cursor += 1;
        if (Object.hasOwn(FUNCTION_TABLE, token.value)) {
          expect('(');
          const argument = parseAdditive();
          expect(')');
          return { type: 'function', name: token.value, argument };
        }
        if (token.value === 'x' || token.value === 'y') {
          usedVariables.add(token.value);
          return { type: 'variable', name: token.value };
        }
        throw new Error(`Variable o función desconocida: «${token.value}».`);
      }

      if (accept('(')) {
        const expression = parseAdditive();
        expect(')');
        return expression;
      }

      throw new Error(`No se esperaba «${token.value}» en la fórmula.`);
    }

    const ast = parseAdditive();
    if (cursor < tokens.length) throw new Error(`No se esperaba «${current().value}» en la fórmula.`);

    function evaluate(node, variables) {
      if (node.type === 'number') return node.value;
      if (node.type === 'variable') {
        if (!variables || !Object.hasOwn(variables, node.name)) {
          throw new Error(`Falta el valor de la variable «${node.name}».`);
        }
        return Number(variables[node.name]);
      }
      if (node.type === 'unary') {
        const value = evaluate(node.value, variables);
        return node.operator === '-' ? -value : value;
      }
      if (node.type === 'function') {
        return FUNCTION_TABLE[node.name](evaluate(node.argument, variables));
      }

      const left = evaluate(node.left, variables);
      const right = evaluate(node.right, variables);
      if (node.operator === '/' && right === 0) throw new Error('División por cero.');
      if (node.operator === '+') return left + right;
      if (node.operator === '-') return left - right;
      if (node.operator === '*') return left * right;
      if (node.operator === '/') return left / right;
      return left ** right;
    }

    const compiled = (variables = {}) => {
      const value = evaluate(ast, variables);
      if (!Number.isFinite(value)) throw new Error('La fórmula produjo un valor no finito.');
      return value;
    };
    compiled.variables = usedVariables;
    return compiled;
  }

  function parseExpression(source, variables = {}) {
    return compileExpression(source)(variables);
  }

  const MAX_STEPS = 1000;

  const METHODS = Object.freeze([
    {
      key: 'euler',
      name: 'Euler',
      order: 1,
      description: 'Usa la pendiente en el punto inicial de cada paso.',
      formulaLines: ['k₁ = f(xₙ, yₙ)', 'yₙ₊₁ = yₙ + hₙ · k₁'],
      stageColumns: [['k1', 'k₁ · pendiente inicial']],
    },
    {
      key: 'heun',
      name: 'Euler mejorado · Heun',
      order: 2,
      description: 'Predice con Euler y promedia la pendiente inicial con la pendiente predicha.',
      formulaLines: [
        'k₁ = f(xₙ, yₙ)',
        'zₙ₊₁ = yₙ + hₙ · k₁',
        'k₂ = f(xₙ + hₙ, zₙ₊₁)',
        'yₙ₊₁ = yₙ + hₙ · (k₁ + k₂) / 2',
      ],
      stageColumns: [['k1', 'k₁ · inicial'], ['k2', 'k₂ · predicha']],
    },
    {
      key: 'rk3',
      name: 'Runge-Kutta · RK3',
      order: 3,
      description: 'Combina tres pendientes con pesos 1, 4 y 1.',
      formulaLines: [
        'k₁ = f(xₙ, yₙ)',
        'k₂ = f(xₙ + hₙ/2, yₙ + hₙk₁/2)',
        'k₃ = f(xₙ + hₙ, yₙ − hₙk₁ + 2hₙk₂)',
        'yₙ₊₁ = yₙ + hₙ · (k₁ + 4k₂ + k₃) / 6',
      ],
      stageColumns: [['k1', 'k₁ · inicial'], ['k2', 'k₂ · media'], ['k3', 'k₃ · final']],
    },
    {
      key: 'rk4',
      name: 'Runge-Kutta · RK4',
      order: 4,
      description: 'Combina cuatro pendientes; dos se evalúan en puntos medios.',
      formulaLines: [
        'k₁ = f(xₙ, yₙ)',
        'k₂ = f(xₙ + hₙ/2, yₙ + hₙk₁/2)',
        'k₃ = f(xₙ + hₙ/2, yₙ + hₙk₂/2)',
        'k₄ = f(xₙ + hₙ, yₙ + hₙk₃)',
        'yₙ₊₁ = yₙ + hₙ · (k₁ + 2k₂ + 2k₃ + k₄) / 6',
      ],
      stageColumns: [['k1', 'k₁ · inicial'], ['k2', 'k₂ · media 1'], ['k3', 'k₃ · media 2'], ['k4', 'k₄ · final']],
    },
  ]);

  function validateNumber(name, value) {
    if (value === '' || value === null || value === undefined || !Number.isFinite(Number(value))) {
      throw new Error(`${name} debe ser un número finito.`);
    }
    return Number(value);
  }

  function evaluateFinite(expression, variables, context) {
    try {
      return expression(variables);
    } catch (error) {
      throw new Error(`${context}: ${error.message}`);
    }
  }

  function exactAt(expression, x, y) {
    if (!expression) return { exact: null, relativeError: null };
    try {
      const exact = expression({ x });
      return {
        exact,
        relativeError: exact === 0 ? null : Math.abs((y - exact) / exact) * 100,
      };
    } catch {
      return { exact: null, relativeError: null };
    }
  }

  function runMethod(method, derivative, exact, x0, y0, stepSize, xEnd) {
    const direction = Math.sign(xEnd - x0);
    const rows = [];
    let x = x0;
    let y = y0;

    while (x !== xEnd) {
      if (rows.length >= MAX_STEPS) {
        throw new Error(`El cálculo supera el máximo de ${MAX_STEPS} pasos. Aumenta h o acorta el intervalo.`);
      }

      const remaining = xEnd - x;
      const distance = Math.abs(remaining);
      const tolerance = Number.EPSILON * 8 * Math.max(1, Math.abs(x), Math.abs(xEnd));
      const nextX = distance <= stepSize || distance - stepSize <= tolerance
        ? xEnd
        : x + direction * stepSize;
      const actualH = nextX - x;
      if (actualH === 0) throw new Error('El tamaño de paso es demasiado pequeño para avanzar desde este valor de x.');

      const stepNumber = rows.length + 1;
      let predictor = null;
      let k2 = null;
      let k3 = null;
      let k4 = null;
      let nextY;

      const k1 = evaluateFinite(derivative, { x, y }, `${method.name}, paso ${stepNumber}, k₁ (pendiente inicial)`);
      if (method.key === 'heun') {
        predictor = y + actualH * k1;
        if (!Number.isFinite(predictor)) throw new Error(`Heun, paso ${stepNumber}: la predicción no es finita.`);
        k2 = evaluateFinite(derivative, { x: nextX, y: predictor }, `Heun, paso ${stepNumber}, k₂`);
        nextY = y + actualH * (k1 + k2) / 2;
      } else if (method.key === 'rk3') {
        const midpointX = x + actualH / 2;
        const midpointY = y + actualH * k1 / 2;
        k2 = evaluateFinite(derivative, { x: midpointX, y: midpointY }, `RK3, paso ${stepNumber}, k₂`);
        const finalStageY = y - actualH * k1 + 2 * actualH * k2;
        k3 = evaluateFinite(derivative, { x: nextX, y: finalStageY }, `RK3, paso ${stepNumber}, k₃`);
        nextY = y + actualH * (k1 + 4 * k2 + k3) / 6;
      } else if (method.key === 'rk4') {
        const midpointX = x + actualH / 2;
        k2 = evaluateFinite(derivative, { x: midpointX, y: y + actualH * k1 / 2 }, `RK4, paso ${stepNumber}, k₂`);
        k3 = evaluateFinite(derivative, { x: midpointX, y: y + actualH * k2 / 2 }, `RK4, paso ${stepNumber}, k₃`);
        k4 = evaluateFinite(derivative, { x: nextX, y: y + actualH * k3 }, `RK4, paso ${stepNumber}, k₄`);
        nextY = y + actualH * (k1 + 2 * k2 + 2 * k3 + k4) / 6;
      } else {
        nextY = y + actualH * k1;
      }

      if (!Number.isFinite(nextY)) throw new Error(`${method.name}, paso ${stepNumber}: el siguiente valor de y no es finito.`);
      const reference = exactAt(exact, nextX, nextY);
      rows.push({ step: stepNumber, x, y, h: actualH, k1, predictor, k2, k3, k4, nextX, nextY, ...reference });
      x = nextX;
      y = nextY;
    }

    return {
      rows,
      final: { x, y, ...exactAt(exact, x, y) },
    };
  }

  function solveIVP({ derivative, x0, y0, step, xEnd, exact = '' } = {}) {
    try {
      const startX = validateNumber('x₀', x0);
      const startY = validateNumber('y₀', y0);
      const stepSize = Math.abs(validateNumber('h', step));
      const endX = validateNumber('Punto final', xEnd);
      if (stepSize === 0) throw new Error('h debe ser distinto de cero.');
      if (!Number.isFinite(endX - startX)) throw new Error('El intervalo es demasiado grande para calcularlo.');

      const derivativeText = String(derivative ?? '').trim();
      if (!derivativeText) throw new Error('Escribe la fórmula de la derivada f(x,y).');
      const derivativeFunction = compileExpression(derivativeText);
      const exactText = String(exact ?? '').trim();
      const exactFunction = exactText ? compileExpression(exactText) : null;

      if (exactFunction) {
        if (exactFunction.variables?.has('y')) throw new Error('La solución exacta debe depender solo de x.');
        const initialExact = evaluateFinite(exactFunction, { x: startX }, 'Solución exacta en x₀');
        if (Math.abs(initialExact - startY) > 1e-8 * Math.max(1, Math.abs(initialExact), Math.abs(startY))) {
          throw new Error('La solución exacta no coincide con el valor inicial y₀.');
        }
      }

      const methods = {};
      for (const method of METHODS) {
        methods[method.key] = runMethod(method, derivativeFunction, exactFunction, startX, startY, stepSize, endX);
      }
      return { exactProvided: Boolean(exactFunction), ...methods };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'No se pudo resolver el PVI.' };
    }
  }

  root.EulerHeun = Object.freeze({ compileExpression, parseExpression, solveIVP });
  if (typeof module !== 'undefined' && module.exports) module.exports = root.EulerHeun;

  function formatNumber(value) {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    if (Object.is(value, -0)) return '0';
    return new Intl.NumberFormat('es-PE', { maximumSignificantDigits: 8 }).format(value);
  }

  function makeCell(tag, value) {
    const cell = document.createElement(tag);
    cell.textContent = value;
    return cell;
  }

  function makeTable(method, result, exactProvided) {
    const section = document.createElement('details');
    section.className = 'method-card method-details';

    const summary = document.createElement('summary');
    const identity = document.createElement('span');
    identity.className = 'method-identity';
    const heading = makeCell('strong', method.name);
    const order = makeCell('span', `Orden ${method.order} · ${method.stageColumns.length} ${method.stageColumns.length === 1 ? 'pendiente' : 'pendientes'}`);
    order.className = 'method-order';
    identity.append(heading, order);
    summary.append(identity);

    const detailContent = document.createElement('div');
    detailContent.className = 'method-content';
    const description = makeCell('p', method.description);
    description.className = 'method-description';
    const formulas = document.createElement('div');
    formulas.className = 'method-formulas';
    for (const line of method.formulaLines) formulas.append(makeCell('code', line));

    const table = document.createElement('table');
    const tableHead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const columns = [
      ['n', (row) => String(row.step)],
      ['xₙ', (row) => formatNumber(row.x)],
      ['yₙ', (row) => formatNumber(row.y)],
      ['hₙ', (row) => formatNumber(row.h)],
    ];
    for (const [key, label] of method.stageColumns) {
      columns.push([label, (row) => formatNumber(row[key])]);
      if (method.key === 'heun' && key === 'k1') {
        columns.push(['zₙ₊₁ · predicción', (row) => formatNumber(row.predictor)]);
      }
    }
    columns.push(['xₙ₊₁', (row) => formatNumber(row.nextX)]);
    columns.push(['yₙ₊₁', (row) => formatNumber(row.nextY)]);
    if (exactProvided) {
      columns.push(['y exacta', (row) => formatNumber(row.exact)]);
      columns.push(['Error relativo (%)', (row) => formatNumber(row.relativeError)]);
    }

    for (const [label] of columns) headerRow.append(makeCell('th', label));
    tableHead.append(headerRow);
    const body = document.createElement('tbody');

    if (!result.rows.length) {
      const row = document.createElement('tr');
      const cell = makeCell('td', 'El punto final coincide con el valor inicial; no se requieren pasos.');
      cell.colSpan = columns.length;
      row.append(cell);
      body.append(row);
    } else {
      for (const data of result.rows) {
        const row = document.createElement('tr');
        for (const [, value] of columns) row.append(makeCell('td', value(data)));
        body.append(row);
      }
    }

    table.append(tableHead, body);
    const tableScroll = document.createElement('div');
    tableScroll.className = 'table-scroll';
    tableScroll.append(table);
    detailContent.append(description, formulas, tableScroll);
    section.append(summary, detailContent);
    return section;
  }

  function makeSummaryCard(method, result, exactProvided) {
    const card = document.createElement('article');
    card.className = 'summary-card';
    const heading = makeCell('h3', method.name);
    const order = makeCell('p', `Orden ${method.order}`);
    order.className = 'summary-order';
    const value = makeCell('p', formatNumber(result.final.y));
    value.className = 'summary-value';
    const details = document.createElement('div');
    details.className = 'summary-details';

    const reference = exactProvided ? formatNumber(result.final.exact) : 'No ingresada';
    const error = !exactProvided
      ? 'No disponible sin solución exacta'
      : result.final.relativeError === null
        ? 'No definido (valor exacto no disponible o igual a cero)'
        : `${formatNumber(result.final.relativeError)} %`;

    const referenceLine = document.createElement('span');
    referenceLine.append(makeCell('strong', 'Valor exacto: '), document.createTextNode(reference));
    const errorLine = document.createElement('span');
    errorLine.append(makeCell('strong', 'Error relativo: '), document.createTextNode(error));
    const endpointLine = document.createElement('span');
    endpointLine.append(makeCell('strong', 'Punto final: '), document.createTextNode(`x = ${formatNumber(result.final.x)}`));
    details.append(referenceLine, errorLine, endpointLine);
    card.append(heading, order, value, details);
    return card;
  }

  function initializePage() {
    const form = document.getElementById('solver-form');
    if (!form) return;

    const errorMessage = document.getElementById('error-message');
    const results = document.getElementById('results');
    const summaryGrid = document.getElementById('summary-grid');
    const tablesGrid = document.getElementById('tables-grid');
    const referenceNote = document.getElementById('reference-note');
    const slopeNote = document.getElementById('slope-note');
    const resultFootnote = document.getElementById('result-footnote');

    function clearOutput() {
      errorMessage.hidden = true;
      errorMessage.textContent = '';
      results.hidden = true;
      summaryGrid.replaceChildren();
      tablesGrid.replaceChildren();
      referenceNote.textContent = '';
      slopeNote.textContent = '';
      resultFootnote.textContent = '';
    }

    form.addEventListener('input', clearOutput);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      clearOutput();

      const formValues = new FormData(form);
      const result = solveIVP({
        derivative: formValues.get('derivative'),
        exact: formValues.get('exact'),
        x0: formValues.get('x0'),
        y0: formValues.get('y0'),
        step: formValues.get('step'),
        xEnd: formValues.get('xEnd'),
      });

      if (result.error) {
        errorMessage.textContent = result.error;
        errorMessage.hidden = false;
        return;
      }

      for (const method of METHODS) {
        summaryGrid.append(makeSummaryCard(method, result[method.key], result.exactProvided));
        tablesGrid.append(makeTable(method, result[method.key], result.exactProvided));
      }
      referenceNote.textContent = result.exactProvided
        ? 'El error relativo compara cada aproximación con la solución exacta ingresada.'
        : 'Sin una solución exacta ingresada, no se calcula el error relativo.';
      slopeNote.textContent = 'Cada kᵢ es una pendiente f(x, y). En cada método se evalúa en distintos puntos; hₙ se aplica al combinar esas pendientes. Abre un método para ver sus fórmulas y pasos.';
      resultFootnote.textContent = 'Error relativo (%) = |(aproximación − valor exacto) / valor exacto| × 100. “—” indica que la fórmula exacta no se pudo evaluar en ese punto o que el error relativo no está definido.';
      results.hidden = false;
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializePage, { once: true });
    else initializePage();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
