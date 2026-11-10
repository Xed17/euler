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

  function runMethod(name, derivative, exact, x0, y0, stepSize, xEnd) {
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
      const k1 = evaluateFinite(derivative, { x, y }, `${name}, paso ${stepNumber}, pendiente inicial`);
      let predictor = null;
      let k2 = null;
      let nextY;

      if (name === 'Heun') {
        predictor = y + actualH * k1;
        if (!Number.isFinite(predictor)) throw new Error(`Heun, paso ${stepNumber}: la predicción no es finita.`);
        k2 = evaluateFinite(derivative, { x: nextX, y: predictor }, `${name}, paso ${stepNumber}, pendiente final`);
        nextY = y + actualH * (k1 + k2) / 2;
      } else {
        nextY = y + actualH * k1;
      }

      if (!Number.isFinite(nextY)) throw new Error(`${name}, paso ${stepNumber}: el siguiente valor de y no es finito.`);
      const reference = exactAt(exact, nextX, nextY);
      rows.push({ step: stepNumber, x, y, h: actualH, k1, predictor, k2, nextX, nextY, ...reference });
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

      return {
        exactProvided: Boolean(exactFunction),
        euler: runMethod('Euler', derivativeFunction, exactFunction, startX, startY, stepSize, endX),
        heun: runMethod('Heun', derivativeFunction, exactFunction, startX, startY, stepSize, endX),
      };
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

  function makeTable(title, subtitle, result, methodName, exactProvided) {
    const section = document.createElement('article');
    section.className = 'method-card';

    const header = document.createElement('header');
    const heading = document.createElement('h3');
    heading.textContent = title;
    const description = document.createElement('p');
    description.textContent = subtitle;
    header.append(heading, description);

    const tableScroll = document.createElement('div');
    tableScroll.className = 'table-scroll';
    const table = document.createElement('table');
    const tableHead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const columns = [
      ['n', (row) => String(row.step)],
      ['xₙ', (row) => formatNumber(row.x)],
      ['yₙ', (row) => formatNumber(row.y)],
      ['hₙ', (row) => formatNumber(row.h)],
      ['k₁', (row) => formatNumber(row.k1)],
    ];
    if (methodName === 'Heun') {
      columns.push(['Predicción', (row) => formatNumber(row.predictor)]);
      columns.push(['k₂', (row) => formatNumber(row.k2)]);
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
    tableScroll.append(table);
    section.append(header, tableScroll);
    return section;
  }

  function makeSummaryCard(title, result, exactProvided) {
    const card = document.createElement('article');
    card.className = 'summary-card';
    const heading = makeCell('h3', title);
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
    card.append(heading, value, details);
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
    const resultFootnote = document.getElementById('result-footnote');

    function clearOutput() {
      errorMessage.hidden = true;
      errorMessage.textContent = '';
      results.hidden = true;
      summaryGrid.replaceChildren();
      tablesGrid.replaceChildren();
      referenceNote.textContent = '';
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

      summaryGrid.append(
        makeSummaryCard('Euler', result.euler, result.exactProvided),
        makeSummaryCard('Euler mejorado · Heun', result.heun, result.exactProvided),
      );
      tablesGrid.append(
        makeTable('Método de Euler', 'Pendiente evaluada al inicio de cada paso.', result.euler, 'Euler', result.exactProvided),
        makeTable('Euler mejorado · Heun', 'Promedio de la pendiente inicial y la pendiente predicha.', result.heun, 'Heun', result.exactProvided),
      );
      referenceNote.textContent = result.exactProvided
        ? 'El error relativo compara cada aproximación con la solución exacta ingresada.'
        : 'Sin una solución exacta ingresada, no se calcula el error relativo.';
      resultFootnote.textContent = 'Error relativo (%) = |(aproximación − valor exacto) / valor exacto| × 100. “—” indica que la fórmula exacta no se pudo evaluar en ese punto.';
      results.hidden = false;
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializePage, { once: true });
    else initializePage();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
