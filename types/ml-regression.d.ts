declare module 'ml-regression' {
  export class PolynomialRegression {
    constructor(x: number[], y: number[], degree: number)
    coefficients: number[]
    predict(x: number): number
  }
}

declare module 'ml-logistic-regression' {
  class LogisticRegression {
    constructor(options?: Record<string, unknown>)
    train(features: number[][], labels: number[]): void
    predict(features: number[][]): number[]
  }
  export default LogisticRegression
}

declare module 'ml-random-forest' {
  export class RandomForestRegression {
    constructor(options?: Record<string, unknown>)
    train(features: number[][], labels: number[]): void
    predict(features: number[][]): number[]
  }
  export class RandomForestClassifier {
    constructor(options?: Record<string, unknown>)
    train(features: number[][], labels: number[]): void
    predict(features: number[][]): number[]
  }
}
