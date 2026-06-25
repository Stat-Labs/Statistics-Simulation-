import * as ss from 'simple-statistics'
import type {
  Row, Column, CorrelationResult, HypothesisResult,
  InferentialResult, RegressionResult, AnalysisRequest
} from '@/lib/types'

function extractNumeric(data: Row[], columnName: string): number[] {
  const nums: number[] = []
  for (const row of data) {
    const val = row[columnName]
    if (val === null || val === undefined || val === '') continue
    const n = typeof val === 'number' ? val : Number(val)
    if (!isNaN(n)) nums.push(n)
  }
  return nums
}

function extractPaired(data: Row[], colA: string, colB: string): [number, number][] {
  const pairs: [number, number][] = []
  for (const row of data) {
    const va = row[colA]; const vb = row[colB]
    if (va === null || va === undefined || va === '') continue
    if (vb === null || vb === undefined || vb === '') continue
    const na = typeof va === 'number' ? va : Number(va)
    const nb = typeof vb === 'number' ? vb : Number(vb)
    if (isNaN(na) || isNaN(nb)) continue
    pairs.push([na, nb])
  }
  return pairs
}

function computeNullRatio(data: Row[], columnName: string): number {
  let nulls = 0
  for (const row of data) {
    const val = row[columnName]
    if (val === null || val === undefined || val === '' || val === 'NA' || val === 'NaN' || val === 'null') nulls++
  }
  return data.length > 0 ? nulls / data.length : 1
}

function safeCompute<T>(fn: () => T): T | null {
  try { return fn() } catch { return null }
}

function rankValues(values: number[]): number[] {
  const indexed = values.map((v, i) => ({ v, i }))
  indexed.sort((a, b) => a.v - b.v)
  const ranks: number[] = new Array(values.length)
  for (let j = 0; j < indexed.length; j++) {
    ranks[indexed[j].i] = j + 1
  }
  return ranks
}

function interpretCorrelation(r: number): CorrelationResult['interpretation'] {
  const abs = Math.abs(r)
  const direction = r >= 0 ? 'positive' : 'negative'
  if (abs >= 0.7) return direction === 'positive' ? 'strong positive' : 'strong negative'
  if (abs >= 0.4) return direction === 'positive' ? 'moderate positive' : 'moderate negative'
  return 'weak'
}

function chiSquareCdf(x: number, k: number): number {
  if (x <= 0) return 0
  return safeCompute(() => ss.cumulativeStdNormalProbability(
    (Math.pow(x / k, 1 / 3) - (1 - 2 / (9 * k))) / Math.sqrt(2 / (9 * k))
  )) ?? 0
}

function fCdf(x: number, d1: number, d2: number): number {
  if (x <= 0) return 0
  const numerator = Math.pow(x * d1 / d2, 1 / 3) * (1 - 2 / (9 * d2)) - (1 - 2 / (9 * d1))
  const denominator = Math.sqrt(2 / (9 * d1) + Math.pow(x * d1 / d2, 2 / 3) * 2 / (9 * d2))
  const z = numerator / denominator
  return safeCompute(() => ss.cumulativeStdNormalProbability(z)) ?? 0
}

export function computeCorrelation(
  data: Row[],
  columnA: string,
  columnB: string,
  colAType: Column['type'],
  colBType: Column['type']
): CorrelationResult {
  const isContA = colAType === 'continuous'
  const isContB = colBType === 'continuous'
  const isOrdA = colAType === 'ordinal'
  const isOrdB = colBType === 'ordinal'
  const isBinA = colAType === 'binary'
  const isBinB = colBType === 'binary'

  let r = 0
  let method: 'pearson' | 'spearman' = 'pearson'

  const defaultResult: CorrelationResult = {
    columnA, columnB, r: 0, method: 'pearson', interpretation: 'weak'
  }

  if (isContA && isContB) {
    method = 'pearson'
    const pairs = extractPaired(data, columnA, columnB)
    if (pairs.length < 3) return { ...defaultResult, method }
    r = safeCompute(() => ss.sampleCorrelation(pairs.map(p => p[0]), pairs.map(p => p[1]))) ?? 0
  } else if (isOrdA || isOrdB) {
    method = 'spearman'
    const pairs = extractPaired(data, columnA, columnB)
    if (pairs.length < 3) return { ...defaultResult, method }
    const ranksA = rankValues(pairs.map(p => p[0]))
    const ranksB = rankValues(pairs.map(p => p[1]))
    r = safeCompute(() => ss.sampleCorrelation(ranksA, ranksB)) ?? 0
  } else if ((isBinA && isContB) || (isContA && isBinB)) {
    method = 'pearson'
    const [binCol, contCol] = isBinA ? [columnA, columnB] : [columnB, columnA]
    const pairs: [number, number][] = []
    for (const row of data) {
      const bv = row[binCol]; const cv = row[contCol]
      if (bv === null || bv === undefined || bv === '') continue
      if (cv === null || cv === undefined || cv === '') continue
      const bStr = String(bv).trim().toLowerCase()
      let encoded: number | null = null
      if (bStr === '1' || bStr === 'true' || bStr === 'yes') encoded = 1
      else if (bStr === '0' || bStr === 'false' || bStr === 'no') encoded = 0
      if (encoded === null) continue
      const cvNum = typeof cv === 'number' ? cv : Number(cv)
      if (isNaN(cvNum)) continue
      pairs.push([encoded, cvNum])
    }
    if (pairs.length < 3) return { ...defaultResult }
    r = safeCompute(() => ss.sampleCorrelation(pairs.map(p => p[0]), pairs.map(p => p[1]))) ?? 0
  }

  const interpretation = interpretCorrelation(r)
  return { columnA, columnB, r, method, interpretation }
}

export function computeAllCorrelations(
  data: Row[],
  columns: Column[],
  pairs: [string, string][]
): CorrelationResult[] {
  const results: CorrelationResult[] = []

  if (pairs.length > 0) {
    const colMap = new Map(columns.map(c => [c.name, c]))
    for (const [a, b] of pairs) {
      const colA = colMap.get(a); const colB = colMap.get(b)
      if (!colA || !colB) continue
      if (computeNullRatio(data, a) > 0.8 || computeNullRatio(data, b) > 0.8) continue
      results.push(computeCorrelation(data, a, b, colA.type, colB.type))
    }
    return results
  }

  const numericColumns = columns.filter(c =>
    c.type === 'continuous' || c.type === 'ordinal' || c.type === 'binary'
  )
  for (let i = 0; i < numericColumns.length; i++) {
    for (let j = i + 1; j < numericColumns.length; j++) {
      const a = numericColumns[i].name; const b = numericColumns[j].name
      if (computeNullRatio(data, a) > 0.8 || computeNullRatio(data, b) > 0.8) continue
      results.push(computeCorrelation(data, a, b, numericColumns[i].type, numericColumns[j].type))
    }
  }
  return results
}

export function computeCorrelationMatrix(
  data: Row[],
  columns: Column[]
): { columns: string[]; matrix: number[][] } {
  const numericCols = columns.filter(c => c.type === 'continuous' || c.type === 'ordinal')
  const names = numericCols.map(c => c.name)
  const n = names.length
  const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(1))

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const r = safeCompute(() => {
        const pairs = extractPaired(data, names[i], names[j])
        if (pairs.length < 3) return 0
        return ss.sampleCorrelation(pairs.map(p => p[0]), pairs.map(p => p[1]))
      }) ?? 0
      matrix[i][j] = r
      matrix[j][i] = r
    }
  }

  return { columns: names, matrix }
}

export function tTest(
  data: Row[],
  column: string,
  hypothesisedMean?: number,
  groupColumn?: string
): HypothesisResult {
  if (groupColumn) {
    const groups = new Map<string, number[]>()
    for (const row of data) {
      const g = row[groupColumn]
      if (g === null || g === undefined) continue
      const key = String(g)
      const val = row[column]
      if (val === null || val === undefined || val === '') continue
      const n = typeof val === 'number' ? val : Number(val)
      if (isNaN(n)) continue
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(n)
    }
    const entries = Array.from(groups.entries())
    if (entries.length !== 2) {
      const cols = [column]
      if (groupColumn) cols.push(groupColumn)
      return { testType: 't-test', statistic: 0, pValue: 1, significant: false, confidenceLevel: 0.95, columns: cols }
    }
    const [g1, g2] = [entries[0][1], entries[1][1]]
    if (g1.length < 3 || g2.length < 3) {
      return { testType: 't-test', statistic: 0, pValue: 1, significant: false, confidenceLevel: 0.95, columns: [column, groupColumn] }
    }
    const stat = safeCompute(() => ss.tTestTwoSample(g1, g2)) ?? 0
    const p = 2 * (1 - (ss.cumulativeStdNormalProbability(Math.abs(stat))))
    return {
      testType: 't-test',
      statistic: stat,
      pValue: Math.min(Math.max(p, 0), 1),
      significant: p < 0.05,
      confidenceLevel: 0.95,
      columns: [column, groupColumn]
    }
  }

  const values = extractNumeric(data, column)
  if (values.length < 3) {
    return { testType: 't-test', statistic: 0, pValue: 1, significant: false, confidenceLevel: 0.95, columns: [column] }
  }
  const mu = hypothesisedMean ?? 0
  const stat = safeCompute(() => ss.tTest(values, mu)) ?? 0
  // Approximate p-value using normal CDF (valid for large samples per CLT)
  const p = 2 * (1 - ss.cumulativeStdNormalProbability(Math.abs(stat)))
  return {
    testType: 't-test',
    statistic: stat,
    pValue: Math.min(Math.max(p, 0), 1),
    significant: p < 0.05,
    confidenceLevel: 0.95,
    columns: [column]
  }
}

export function chiSquareTest(
  data: Row[],
  columnA: string,
  columnB: string
): HypothesisResult {
  const colInfo: { name: string; isCat: boolean }[] = []
  for (const colName of [columnA, columnB]) {
    const values = new Set<string>()
    for (const row of data) {
      const v = row[colName]
      if (v !== null && v !== undefined) values.add(String(v))
    }
    colInfo.push({ name: colName, isCat: values.size > 0 && values.size <= 15 })
  }

  if (!colInfo[0].isCat || !colInfo[1].isCat) {
    return {
      testType: 'chi-square', statistic: 0, pValue: 1, significant: false,
      confidenceLevel: 0.95, columns: [columnA, columnB]
    }
  }

  const observed = new Map<string, Map<string, number>>()
  const rowTotals = new Map<string, number>()
  const colTotals = new Map<string, number>()
  let grandTotal = 0

  for (const row of data) {
    const av = row[columnA]; const bv = row[columnB]
    if (av === null || av === undefined || bv === null || bv === undefined) continue
    const aKey = String(av); const bKey = String(bv)
    if (!observed.has(aKey)) observed.set(aKey, new Map())
    const rowMap = observed.get(aKey)!
    rowMap.set(bKey, (rowMap.get(bKey) || 0) + 1)
    rowTotals.set(aKey, (rowTotals.get(aKey) || 0) + 1)
    colTotals.set(bKey, (colTotals.get(bKey) || 0) + 1)
    grandTotal++
  }

  if (grandTotal === 0) {
    return { testType: 'chi-square', statistic: 0, pValue: 1, significant: false, confidenceLevel: 0.95, columns: [columnA, columnB] }
  }

  const rows = Array.from(observed.keys())
  const cols = Array.from(colTotals.keys())
  const df = (rows.length - 1) * (cols.length - 1)
  if (df <= 0) {
    return { testType: 'chi-square', statistic: 0, pValue: 1, significant: false, confidenceLevel: 0.95, columns: [columnA, columnB] }
  }

  let chi2 = 0
  for (const r of rows) {
    for (const c of cols) {
      const obs = observed.get(r)?.get(c) || 0
      const exp = (rowTotals.get(r)! * colTotals.get(c)!) / grandTotal
      if (exp > 0) chi2 += (obs - exp) ** 2 / exp
    }
  }

  // Approximate chi-square p-value using Wilson-Hilferty transformation
  const p = 1 - chiSquareCdf(chi2, df)

  return {
    testType: 'chi-square',
    statistic: chi2,
    pValue: Math.min(Math.max(p, 0), 1),
    significant: p < 0.05,
    confidenceLevel: 0.95,
    columns: [columnA, columnB]
  }
}

export function anovaTest(
  data: Row[],
  valueColumn: string,
  groupColumn: string
): HypothesisResult {
  const groups = new Map<string, number[]>()
  for (const row of data) {
    const g = row[groupColumn]
    if (g === null || g === undefined) continue
    const key = String(g)
    const val = row[valueColumn]
    if (val === null || val === undefined || val === '') continue
    const n = typeof val === 'number' ? val : Number(val)
    if (isNaN(n)) continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(n)
  }

  const groupEntries = Array.from(groups.values()).filter(g => g.length >= 2)
  if (groupEntries.length < 2) {
    return { testType: 'anova', statistic: 0, pValue: 1, significant: false, confidenceLevel: 0.95, columns: [valueColumn, groupColumn] }
  }

  const allValues = groupEntries.flat()
  const grandMean = ss.mean(allValues)
  const N = allValues.length
  const k = groupEntries.length

  let ssBetween = 0
  let ssWithin = 0
  for (const g of groupEntries) {
    const groupMean = ss.mean(g)
    ssBetween += g.length * (groupMean - grandMean) ** 2
    for (const v of g) ssWithin += (v - groupMean) ** 2
  }

  const dfBetween = k - 1
  const dfWithin = N - k
  if (dfBetween <= 0 || dfWithin <= 0) {
    return { testType: 'anova', statistic: 0, pValue: 1, significant: false, confidenceLevel: 0.95, columns: [valueColumn, groupColumn] }
  }

  const msBetween = ssBetween / dfBetween
  const msWithin = ssWithin / dfWithin
  const F = msWithin > 0 ? msBetween / msWithin : 0

  // Approximate F-distribution p-value
  const p = 1 - fCdf(F, dfBetween, dfWithin)

  return {
    testType: 'anova',
    statistic: F,
    pValue: Math.min(Math.max(p, 0), 1),
    significant: p < 0.05,
    confidenceLevel: 0.95,
    columns: [valueColumn, groupColumn]
  }
}

function computeSimpleRegression(
  data: Row[],
  dependent: string,
  predictors: string[]
): RegressionResult | null {
  if (predictors.length === 0) return null
  const y = extractNumeric(data, dependent)
  if (y.length < 3) return null

  const xMat: number[][] = predictors.map(p => extractNumeric(data, p))
  if (xMat.some(col => col.length < 3)) return null

  const minLen = Math.min(y.length, ...xMat.map(col => col.length))
  const yTrimmed = y.slice(0, minLen)
  const xTrimmed = xMat.map(col => col.slice(0, minLen))

  let coefficients: number[] = []
  let intercept = 0
  let rSquared = 0

  if (predictors.length === 1) {
    const pairs = xTrimmed[0].map((x, i) => [x, yTrimmed[i]] as [number, number])
    const reg = safeCompute(() => ss.linearRegression(pairs))
    const regLine = reg ? ss.linearRegressionLine(reg) : null
    if (reg && regLine) {
      intercept = reg.b
      coefficients = [reg.m]
      const yHat = xTrimmed[0].map(regLine)
      const yMean = ss.mean(yTrimmed)
      const ssRes = yTrimmed.reduce((sum, yi, i) => sum + (yi - yHat[i]) ** 2, 0)
      const ssTot = yTrimmed.reduce((sum, yi) => sum + (yi - yMean) ** 2, 0)
      rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0
    }
  } else {
    // Multiple regression via OLS
    const X: number[][] = yTrimmed.map((_, i) => [1, ...xTrimmed.map(col => col[i])])
    const Xt = X[0].map((_, col) => X.map(row => row[col]))
    const XtX = Xt.map(row => X[0].map((_, j) => row.reduce((sum, _, k) => sum + row[k] * X[k][j], 0)))
    const XtY = Xt.map(row => row.reduce((sum, _, k) => sum + row[k] * yTrimmed[k], 0))
    // Gaussian elimination
    const nEq = XtX.length
    const aug = XtX.map((row, i) => [...row, XtY[i]])
    for (let col = 0; col < nEq; col++) {
      let maxRow = col
      for (let row = col + 1; row < nEq; row++) {
        if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row
      }
      [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]]
      const pivot = aug[col][col]
      if (Math.abs(pivot) < 1e-12) continue
      for (let row = col; row <= nEq; row++) aug[col][row] /= pivot
      for (let row = 0; row < nEq; row++) {
        if (row !== col) {
          const factor = aug[row][col]
          for (let j = col; j <= nEq; j++) aug[row][j] -= factor * aug[col][j]
        }
      }
    }
    const beta = aug.map(row => row[nEq])
    intercept = beta[0]
    coefficients = beta.slice(1)
    const yPred = X.map(row => row.reduce((sum, x, j) => sum + x * beta[j], 0))
    const yMean = ss.mean(yTrimmed)
    const ssRes = yTrimmed.reduce((sum, yi, i) => sum + (yi - yPred[i]) ** 2, 0)
    const ssTot = yTrimmed.reduce((sum, yi) => sum + (yi - yMean) ** 2, 0)
    rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0
  }

  const predictions = xTrimmed[0].map((_, i) => {
    let pred = intercept
    for (let p = 0; p < predictors.length; p++) pred += coefficients[p] * xTrimmed[p][i]
    return pred
  })
  const residuals = yTrimmed.map((yi, i) => yi - predictions[i])
  const mse = residuals.reduce((s, r) => s + r * r, 0) / residuals.length
  const rmse = Math.sqrt(mse)

  const result: RegressionResult = {
    modelType: 'linear',
    dependent,
    predictors,
    coefficients,
    intercept,
    rSquared,
    adjustedRSquared: 1 - (1 - rSquared) * (yTrimmed.length - 1) / (yTrimmed.length - predictors.length - 1),
    mse,
    rmse,
    predictions,
    residuals,
  }
  return result
}

export function computeInferential(
  data: Row[],
  columns: Column[],
  request: AnalysisRequest['inferential']
): InferentialResult {
  const result: InferentialResult = {}

  if (!request) return result

  try {
    if (request.correlationPairs || (!request.correlationPairs && !request.hypothesisTests && !request.regression)) {
      result.correlations = computeAllCorrelations(data, columns, request.correlationPairs ?? [])
    } else if (request.correlationPairs) {
      result.correlations = computeAllCorrelations(data, columns, request.correlationPairs)
    }

    if (request.hypothesisTests && request.hypothesisTests.length > 0) {
      result.hypothesisTests = []
      for (const ht of request.hypothesisTests) {
        if (ht.columns.length < 2) continue
        try {
          switch (ht.type) {
            case 't-test': {
              const [valCol, groupCol] = ht.columns
              result.hypothesisTests.push(tTest(data, valCol, undefined, groupCol))
              break
            }
            case 'chi-square': {
              const [colA, colB] = ht.columns
              result.hypothesisTests.push(chiSquareTest(data, colA, colB))
              break
            }
            case 'anova': {
              const [valCol, groupCol] = ht.columns
              result.hypothesisTests.push(anovaTest(data, valCol, groupCol))
              break
            }
          }
        } catch { /* skip failed test */ }
      }
    }

    if (request.regression) {
      const reg = computeSimpleRegression(data, request.regression.dependent, request.regression.predictors)
      if (reg) result.regression = reg
    }
  } catch { /* return partial result */ }

  return result
}