import http from 'http'
import fs from 'fs'

const csv = fs.readFileSync('C:/statslab/test-data.csv')
const boundary = '----' + Date.now()
const analyses = JSON.stringify({
  mode: 'manual',
  descriptive: { columns: ['age', 'score'], measures: ['central', 'spread', 'distribution'] },
  inferential: { correlationPairs: [['age', 'score']] },
  predictive: { dependent: 'score', predictors: ['age'], modelType: 'linear' }
})

let body = ''
body += '--' + boundary + '\r\n'
body += 'Content-Disposition: form-data; name="file"; filename="test-data.csv"\r\n'
body += 'Content-Type: text/csv\r\n\r\n'
body += csv.toString('utf-8') + '\r\n'
body += '--' + boundary + '\r\n'
body += 'Content-Disposition: form-data; name="analyses"\r\n\r\n'
body += analyses + '\r\n'
body += '--' + boundary + '--\r\n'

const req = http.request({
  hostname: 'localhost', port: 3000, path: '/api/analyse', method: 'POST',
  headers: {
    'Content-Type': 'multipart/form-data; boundary=' + boundary,
    'Content-Length': Buffer.byteLength(body)
  }
}, (res) => {
  let data = ''
  res.on('data', chunk => data += chunk)
  res.on('end', () => {
    const j = JSON.parse(data)
    if (j.success) {
      console.log('✓ /api/analyse')
      console.log('  Descriptive:', j.result.descriptive.length)
      console.log('  Correlations:', j.result.inferential?.correlations?.length ?? 0)
      console.log('  Regression:', j.result.predictive.modelType, '- R² =', j.result.predictive.regressionResult?.rSquared)
      console.log('  Rows:', j.schema.rowCount)
    } else {
      console.log('✗', j.error)
    }
  })
})
req.write(body)
req.end()
