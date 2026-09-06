import { describe, expect, it } from 'vitest'
import { estimateTokens } from '../src/core/estimator'
import { encode } from 'gpt-tokenizer/encoding/o200k_base'

const PROSE = `We're building a personal finance dashboard in React with CSV bank-statement import.
The dashboard groups spending by category and month, then computes a rolling ninety-day
average per category so unusual months stand out. We normalize merchant names because the
same merchant appears under five different display strings in the raw statements.`

const CODE = `export function Dashboard({ statements }: Props) {
  const { data } = useTransactions(statements)
  return (
    <Grid>
      {CHARTS.map((c) => (
        <ChartCard key={c.id} chart={c} data={data} />
      ))}
    </Grid>
  )
}`

const CJK = `我们在构建一个个人财务仪表盘，支持 CSV 银行账单导入。` +
  `ダッシュボードはカテゴリごとの支出を表示します。개인 재무 대시보드를 만들고 있습니다.`

const LONG = PROSE.repeat(12)

function ratio(text: string): number {
  const exact = encode(text).length
  const estimate = estimateTokens(text)
  return Math.abs(estimate - exact) / exact
}

describe('estimateTokens calibration (vs gpt-tokenizer o200k_base)', () => {
  it('is within 35% on English prose', () => {
    expect(ratio(PROSE)).toBeLessThan(0.35)
  })

  it('is within 40% on code', () => {
    expect(ratio(CODE)).toBeLessThan(0.4)
  })

  it('is within 70% on CJK text (rough by design)', () => {
    expect(ratio(CJK)).toBeLessThan(0.7)
  })

  it('stays within 35% on long text', () => {
    expect(ratio(LONG)).toBeLessThan(0.35)
  })

  it('handles empty and tiny inputs', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('hi')).toBeGreaterThan(0)
  })

  it('counts CJK characters at roughly 0.85 tokens each', () => {
    const cjkOnly = '你好世界' // 4 CJK chars, no other text
    expect(estimateTokens(cjkOnly)).toBe(3) // round(4 × 0.85)
  })
})
