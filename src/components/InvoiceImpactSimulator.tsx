'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  Building2,
  CheckCircle2,
  ChevronDown,
  FileCheck2,
  FileSpreadsheet,
  LockKeyhole,
  RefreshCcw,
  ShieldCheck,
  UploadCloud,
} from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { tkcContextPack } from '@/src/contextPacks/tkc';
import { appMeta } from '@/src/config/app-meta';
import { analyzeCsv, formatYen, spanDays } from '@/src/domain/analysis';
import {
  inferMappings,
  isTkcJournalFormat,
  parseCsv,
  readCsvFile,
} from '@/src/domain/csv';
import { rateLabel, transitionRateOptions } from '@/src/domain/rates';
import { registerInvoiceComparisonTool } from '@/src/domain/webmcp';
import type {
  AnalysisSettings,
  CalculationMethod,
  CsvData,
  EntryMapping,
  RatePreset,
} from '@/src/domain/types';

const defaultSettings: AnalysisSettings = {
  beforeRate: 0.8,
  afterRate: 0.7,
  amountMode: 'included',
  defaultTaxRate: 10,
  calculationMethod: 'full',
  taxableSalesRatio: 1,
};

const sampleText = `取引年月日,課税区分,税込金額,税率,取引先,摘要
2026/04/15,52,"1,100,000",10%,西日本デザイン,業務委託料
2026/05/20,62,"330,000",10%,みなと管理,賃借関連費
2026/06/10,72,"540,000",8%,神戸フーズ,会議用飲食料品
2026/07/01,5,"220,000",10%,登録済み商事,対象外の仕入れ`;

function createSampleCsv(): CsvData {
  const parsed = parseCsv(sampleText);
  return {
    fileName: 'サンプル仕訳.csv',
    encoding: 'UTF-8',
    headers: parsed[0],
    rows: parsed.slice(1),
  };
}

function formatDate(value: string | null): string {
  return value ? value.replace(/-/g, '/') : '日付列なし';
}

function mappingValue(index: number | null): string {
  return index === null ? 'none' : String(index);
}

function fullRateLabel(value: RatePreset): string {
  return transitionRateOptions.find((option) => option.value === value)?.label ?? rateLabel(value);
}

function csvHeaderLabel(headers: string[], index: number): string {
  return headers[index] || `列 ${index + 1}`;
}

type ColumnSelectProps = {
  label: string;
  value: number | null;
  headers: string[];
  optional?: boolean;
  onChange: (value: number | null) => void;
};

function ColumnSelect({ label, value, headers, optional, onChange }: ColumnSelectProps) {
  return (
    <div className="column-field">
      <span>{label}</span>
      <Select
        value={mappingValue(value)}
        onValueChange={(next) => onChange(next === 'none' ? null : Number(next))}
      >
        <SelectTrigger className="h-10 w-full bg-white" aria-label={`${label}の列`}>
          <SelectValue>
            {value === null ? '使用しない' : csvHeaderLabel(headers, value)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {optional ? <SelectItem value="none">使用しない</SelectItem> : null}
          {headers.map((header, index) => (
            <SelectItem key={`${header}-${index}`} value={String(index)}>
              {header || `列 ${index + 1}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

type ScenarioCardProps = {
  eyebrow: string;
  rate: string;
  amount: number;
  tone: 'before' | 'after' | 'registered';
  max: number;
};

function ScenarioCard({ eyebrow, rate, amount, tone, max }: ScenarioCardProps) {
  const width = max > 0 ? Math.max(4, Math.abs(amount / max) * 100) : 4;
  return (
    <div className={`scenario-card scenario-${tone}`}>
      <div className="scenario-heading">
        <span>{eyebrow}</span>
        <strong>{rate}</strong>
      </div>
      <div className="scenario-amount">{formatYen(amount)}</div>
      <div className="scenario-track" aria-hidden="true">
        <span style={{ width: `${Math.min(100, width)}%` }} />
      </div>
      <p>仕入控除税額（概算）</p>
    </div>
  );
}

function MethodOption({
  value,
  title,
  description,
}: {
  value: CalculationMethod;
  title: string;
  description: string;
}) {
  const id = `calculation-method-${value}`;
  return (
    <label className="method-option" htmlFor={id}>
      <RadioGroupItem id={id} value={value} />
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
    </label>
  );
}

export function InvoiceImpactSimulator() {
  const [csv, setCsv] = useState<CsvData>(() => createSampleCsv());
  const [mappings, setMappings] = useState<EntryMapping[]>(() =>
    inferMappings(createSampleCsv().headers),
  );
  const [settings, setSettings] = useState(defaultSettings);
  const [isSample, setIsSample] = useState(true);
  const [displayMode, setDisplayMode] = useState<'period' | 'annualized'>('annualized');
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const mappingComplete = mappings.every(
    (mapping) => mapping.taxCodeIndex !== null && mapping.amountIndex !== null,
  );
  const tkcJournalDetected = useMemo(() => isTkcJournalFormat(csv.headers), [csv.headers]);
  const mappedTaxCodeValueCount = useMemo(
    () => csv.rows.reduce(
      (count, row) => count + mappings.filter(
        (mapping) => mapping.taxCodeIndex !== null && String(row[mapping.taxCodeIndex] ?? '').trim() !== '',
      ).length,
      0,
    ),
    [csv.rows, mappings],
  );
  const result = useMemo(
    () => (mappingComplete ? analyzeCsv(csv, mappings, settings) : null),
    [csv, mappingComplete, mappings, settings],
  );
  const periodSpan = result ? spanDays(result.sourceDateMin, result.sourceDateMax) : null;
  const annualizationFactor = periodSpan && periodSpan > 0 ? 365 / periodSpan : null;
  const isAnnualized = displayMode === 'annualized' && annualizationFactor !== null;
  const displayFactor = isAnnualized
    ? annualizationFactor
    : 1;
  const maxScenario = result
    ? Math.max(
        Math.abs(result.beforeCredit),
        Math.abs(result.afterCredit),
        Math.abs(result.registeredCredit),
      )
    : 0;

  useEffect(() => registerInvoiceComparisonTool(setSettings), []);

  async function loadFile(file: File | undefined) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('CSVファイルを選んでください。');
      return;
    }
    try {
      const loaded = await readCsvFile(file);
      setCsv(loaded);
      setMappings(inferMappings(loaded.headers));
      setIsSample(false);
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'CSVを読み取れませんでした。');
    }
  }

  function resetSample() {
    const sample = createSampleCsv();
    setCsv(sample);
    setMappings(inferMappings(sample.headers));
    setSettings(defaultSettings);
    setDisplayMode('annualized');
    setIsSample(true);
    setError('');
  }

  function updateMapping(index: number, patch: Partial<EntryMapping>) {
    setMappings((current) =>
      current.map((mapping, mappingIndex) =>
        mappingIndex === index ? { ...mapping, ...patch } : mapping,
      ),
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a
          className="brand-lockup"
          href="https://takatrp.github.io/tool-portal/"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="松本会計ツールポータルへ"
        >
          <div className="brand-mark" aria-hidden="true">
            <img src="./forstaff.png" alt="" />
          </div>
          <div>
            <p>松本会計ツール</p>
            <h1>インボイス経過措置 影響シミュレーター</h1>
          </div>
        </a>
        <div className="privacy-pill">
          <LockKeyhole />
          CSVは端末内だけで処理
        </div>
      </header>

      <section className="transition-strip" aria-label="経過措置の変更">
        <div>
          <span>現在</span>
          <strong>80％</strong>
          <small>～2026.09</small>
        </div>
        <ArrowRight aria-hidden="true" />
        <div className="active">
          <span>次の変更</span>
          <strong>70％</strong>
          <small>2026.10～</small>
        </div>
        <ArrowRight aria-hidden="true" />
        <div>
          <span>その後</span>
          <strong>50％ → 30％ → 0％</strong>
          <small>段階的に縮小</small>
        </div>
        <p>{appMeta.calculationRuleLabel}</p>
      </section>

      <div className="workspace-grid">
        <aside className="control-column">
          <Card className="upload-card">
            <CardHeader>
              <div className="section-kicker">手順 1</div>
              <CardTitle className="text-lg">1年分の仕訳CSVを入れる</CardTitle>
              <CardDescription>
                課税区分52・62・72の仕訳だけを抽出します。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div
                className={`drop-zone ${dragActive ? 'is-dragging' : ''}`}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setDragActive(true);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={() => setDragActive(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragActive(false);
                  void loadFile(event.dataTransfer.files[0]);
                }}
              >
                <UploadCloud aria-hidden="true" />
                <strong>CSVをここへドロップ</strong>
                <span>UTF-8 / Shift_JIS・引用符・セル内改行に対応</span>
                <Button size="lg" onClick={() => fileInputRef.current?.click()}>
                  <FileSpreadsheet />
                  CSVを選ぶ
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="sr-only"
                  onChange={(event) => void loadFile(event.target.files?.[0])}
                />
              </div>

              {error ? (
                <Alert variant="destructive" className="mt-4">
                  <AlertTriangle />
                  <AlertTitle>CSVを確認してください</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}

              <div className="file-summary">
                <div>
                  <FileCheck2 />
                  <span>
                    <strong>{csv.fileName}</strong>
                    <small>
                      {csv.encoding}・{csv.rows.length.toLocaleString('ja-JP')}行
                    </small>
                  </span>
                </div>
                {isSample ? (
                  <Badge className="sample-badge">サンプル表示</Badge>
                ) : tkcJournalDetected ? (
                  <Badge className="detected-badge">TKC仕訳帳・自動設定</Badge>
                ) : (
                  <Badge variant="secondary">列を自動設定</Badge>
                )}
              </div>

              <details className="mapping-panel">
                <summary>
                  <span>
                    <ShieldCheck />
                    読み取る列を確認
                  </span>
                  <ChevronDown />
                </summary>
                <div className="mapping-content">
                  {mappings.map((mapping, index) => (
                    <div className="mapping-set" key={`${mapping.label}-${index}`}>
                      <strong>{mapping.label}の読み取り</strong>
                      <div className="mapping-grid">
                        <ColumnSelect label="課税区分" value={mapping.taxCodeIndex} headers={csv.headers} onChange={(value) => updateMapping(index, { taxCodeIndex: value })} />
                        <ColumnSelect label="金額" value={mapping.amountIndex} headers={csv.headers} onChange={(value) => updateMapping(index, { amountIndex: value })} />
                        <ColumnSelect label="税率" value={mapping.taxRateIndex} headers={csv.headers} optional onChange={(value) => updateMapping(index, { taxRateIndex: value })} />
                        <ColumnSelect label="税額" value={mapping.taxAmountIndex} headers={csv.headers} optional onChange={(value) => updateMapping(index, { taxAmountIndex: value })} />
                        <ColumnSelect label="仕入先" value={mapping.partnerIndex} headers={csv.headers} optional onChange={(value) => updateMapping(index, { partnerIndex: value })} />
                        <ColumnSelect label="取引日" value={mapping.dateIndex} headers={csv.headers} optional onChange={(value) => updateMapping(index, { dateIndex: value })} />
                      </div>
                    </div>
                  ))}
                  {!mappingComplete ? <p className="mapping-error">課税区分列と金額列を選択してください。</p> : null}
                </div>
              </details>
            </CardContent>
          </Card>

          <Card className="settings-card">
            <CardHeader>
              <div className="section-kicker">手順 2</div>
              <CardTitle className="text-lg">試算の前提</CardTitle>
              <CardDescription>まずは変更前後の割合だけで比較できます。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="rate-grid">
                <div className="select-field">
                  <span>変更前</span>
                  <Select value={String(settings.beforeRate)} onValueChange={(value) => setSettings((current) => ({ ...current, beforeRate: Number(value) as RatePreset }))}>
                    <SelectTrigger className="h-11 w-full bg-white" aria-label="変更前の控除割合"><SelectValue>{fullRateLabel(settings.beforeRate)}</SelectValue></SelectTrigger>
                    <SelectContent>{transitionRateOptions.map((option) => <SelectItem key={option.value} value={String(option.value)}>{option.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="rate-arrow"><ArrowDown /></div>
                <div className="select-field">
                  <span>変更後</span>
                  <Select value={String(settings.afterRate)} onValueChange={(value) => setSettings((current) => ({ ...current, afterRate: Number(value) as RatePreset }))}>
                    <SelectTrigger className="h-11 w-full bg-white" aria-label="変更後の控除割合"><SelectValue>{fullRateLabel(settings.afterRate)}</SelectValue></SelectTrigger>
                    <SelectContent>{transitionRateOptions.map((option) => <SelectItem key={option.value} value={String(option.value)}>{option.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <span className="field-label">金額の表示</span>
                <RadioGroup value={isAnnualized ? 'annualized' : 'period'} onValueChange={(value) => setDisplayMode(value as 'period' | 'annualized')} className="display-mode">
                  <label className="display-option" htmlFor="display-period">
                    <RadioGroupItem id="display-period" value="period" />
                    <span><strong>CSV期間</strong><small>読込期間内の実績</small></span>
                  </label>
                  <label className="display-option" htmlFor="display-annualized">
                    <RadioGroupItem id="display-annualized" value="annualized" disabled={!annualizationFactor} />
                    <span><strong>年間換算</strong><small>{periodSpan ? `${periodSpan}日から365日へ換算` : '日付列が必要'}</small></span>
                  </label>
                </RadioGroup>
              </div>

              <div>
                <span className="field-label">仕入控除税額の計算方法</span>
                <RadioGroup value={settings.calculationMethod} onValueChange={(value) => setSettings((current) => ({ ...current, calculationMethod: value as CalculationMethod }))} className="method-grid">
                  <MethodOption value="full" title="全額控除" description="5億円以下かつ課税売上割合95%以上を想定" />
                  <MethodOption value="individual" title="個別対応" description="52・62・72の用途区分を反映" />
                  <MethodOption value="proportional" title="一括比例" description="全対象に課税売上割合を乗算" />
                  <MethodOption value="simplified" title="簡易課税等" description="実額仕入による直接影響は0円" />
                </RadioGroup>
              </div>

              {settings.calculationMethod === 'individual' || settings.calculationMethod === 'proportional' ? (
                <label className="ratio-field" htmlFor="taxable-sales-ratio">
                  <span>課税売上割合</span>
                  <div>
                    <input id="taxable-sales-ratio" type="number" min="0" max="100" step="0.1" value={Math.round(settings.taxableSalesRatio * 1000) / 10} onChange={(event) => {
                      const next = Number(event.target.value);
                      setSettings((current) => ({ ...current, taxableSalesRatio: Number.isFinite(next) ? Math.min(1, Math.max(0, next / 100)) : 0 }));
                    }} />
                    <span>%</span>
                  </div>
                </label>
              ) : null}

              <div className="inline-settings">
                <div className="select-field">
                  <span>CSVの金額</span>
                  <Select value={settings.amountMode} onValueChange={(value) => setSettings((current) => ({ ...current, amountMode: value as AnalysisSettings['amountMode'] }))}>
                    <SelectTrigger className="h-10 w-full bg-white" aria-label="CSV金額の税込・税抜"><SelectValue>{settings.amountMode === 'included' ? '税込' : '税抜'}</SelectValue></SelectTrigger>
                    <SelectContent><SelectItem value="included">税込</SelectItem><SelectItem value="excluded">税抜</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="select-field">
                  <span>税率がない行</span>
                  <Select value={String(settings.defaultTaxRate)} onValueChange={(value) => setSettings((current) => ({ ...current, defaultTaxRate: Number(value) as 8 | 10 }))}>
                    <SelectTrigger className="h-10 w-full bg-white" aria-label="税率がない行の既定税率"><SelectValue>{`既定 ${settings.defaultTaxRate}%`}</SelectValue></SelectTrigger>
                    <SelectContent><SelectItem value="10">標準税率 10%</SelectItem><SelectItem value="8">軽減税率 8%</SelectItem></SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          <Button variant="ghost" className="w-full" onClick={resetSample}><RefreshCcw />サンプルに戻す</Button>
        </aside>

        <section className="result-column" aria-live="polite">
          {!mappingComplete ? (
            <div className="empty-result"><AlertTriangle /><h2>読み取る列を指定してください</h2><p>左の「読み取る列を確認」から、課税区分列と金額列を選びます。</p></div>
          ) : result && result.targetEntries.length === 0 ? (
            <div className="empty-result">
              <FileSpreadsheet />
              {tkcJournalDetected ? <div className="format-detected"><CheckCircle2 />TKC仕訳帳形式を自動認識</div> : null}
              <h2>課税区分52・62・72は0件です</h2>
              <p>{result.sourceRowCount.toLocaleString('ja-JP')}行、{formatDate(result.sourceDateMin)}〜{formatDate(result.sourceDateMax)}を読み取りました。</p>
              {mappedTaxCodeValueCount === 0 ? (
                <Alert className="empty-warning">
                  <AlertTriangle />
                  <AlertTitle>課税区分の値が入っていません</AlertTitle>
                  <AlertDescription>借方課税区分と貸方課税区分が全行空欄です。課税区分を含めて出力したCSVを読み込んでください。</AlertDescription>
                </Alert>
              ) : (
                <p>借方・貸方の課税区分を自動で確認しましたが、対象コードはありませんでした。</p>
              )}
            </div>
          ) : result ? (
            <>
              <div className="result-heading">
                <div>
                  <div className="result-status"><CheckCircle2 /> 試算できました</div>
                  <h2>経過措置の変更による影響</h2>
                  <p>{result.targetEntries.length.toLocaleString('ja-JP')}件・対象仕入 {formatYen(result.grossAmount)}</p>
                </div>
                <div className="period-chip"><span>元CSVの対象期間</span><strong>{formatDate(result.sourceDateMin)} — {formatDate(result.sourceDateMax)}</strong></div>
              </div>

              <div className="impact-hero">
                <div className="impact-copy">
                  <span>{rateLabel(settings.beforeRate)} → {rateLabel(settings.afterRate)}・{isAnnualized ? '年間換算' : 'CSV期間'}</span>
                  <h3>納付増加・還付減少の見込<strong>{formatYen(result.transitionImpact * displayFactor)}</strong></h3>
                  {isAnnualized && periodSpan ? (
                    <p>CSV期間の影響 {formatYen(result.transitionImpact)} × 365日 ÷ {periodSpan}日</p>
                  ) : (
                    <p>元CSVの対象期間内で、仕入控除税額が減る分の概算です。</p>
                  )}
                </div>
                <div className="impact-orbit" aria-hidden="true"><span>{isAnnualized ? '年換算差額' : '期間差額'}</span><strong>{formatYen(result.transitionImpact * displayFactor)}</strong></div>
              </div>

              <div className="scenario-grid">
                <ScenarioCard eyebrow="変更前" rate={rateLabel(settings.beforeRate)} amount={result.beforeCredit * displayFactor} tone="before" max={maxScenario * displayFactor} />
                <ScenarioCard eyebrow="変更後" rate={rateLabel(settings.afterRate)} amount={result.afterCredit * displayFactor} tone="after" max={maxScenario * displayFactor} />
                <ScenarioCard eyebrow="登録事業者なら" rate="100%" amount={result.registeredCredit * displayFactor} tone="registered" max={maxScenario * displayFactor} />
              </div>

              <div className="registered-callout">
                <div className="callout-icon"><Building2 /></div>
                <div>
                  <span>同じ税込価格で、適格請求書を保存できる前提</span>
                  <h3>登録事業者との取引なら、最大 {formatYen(result.registeredBenefit * displayFactor)} の差</h3>
                  <p>{isAnnualized ? '年間換算で、' : 'CSV期間内で、'}変更後時点の未登録仕入先と比べて納付増を避けられる可能性があります。</p>
                </div>
              </div>

              <div className="kpi-grid">
                <div><span>元CSV</span><strong>{result.sourceRowCount.toLocaleString('ja-JP')}行</strong></div>
                <div><span>対象仕訳</span><strong>{result.targetEntries.length.toLocaleString('ja-JP')}件</strong></div>
                <div><span>対象外</span><strong>{result.ignoredRowCount.toLocaleString('ja-JP')}行</strong></div>
                <div><span>仕入税額相当</span><strong>{formatYen(result.taxEquivalent)}</strong></div>
              </div>

              {(result.invalidTargetRowCount > 0 || result.assumedRateCount > 0 || periodSpan === null || periodSpan < 300 || result.hasOneHundredMillionSupplier) ? (
                <Alert className="review-alert">
                  <AlertTriangle />
                  <AlertTitle>確認してから判断してください</AlertTitle>
                  <AlertDescription><ul>
                    {result.invalidTargetRowCount > 0 ? <li>金額を読めなかった対象行が{result.invalidTargetRowCount}件あります。</li> : null}
                    {result.assumedRateCount > 0 ? <li>税率・税額を取得できない{result.assumedRateCount}件は、{settings.defaultTaxRate}%で計算しました。</li> : null}
                    {periodSpan === null ? <li>元CSVの日付を取得できないため、年間換算はできません。取引日列の指定を確認してください。</li> : null}
                    {periodSpan !== null && periodSpan < 300 ? <li>元CSVの対象期間は{periodSpan}日です。年間換算は「CSV期間の影響 × 365 ÷ {periodSpan}」で計算しています。</li> : null}
                    {result.hasOneHundredMillionSupplier ? <li>税込1億円を超える仕入先があります。経過措置の上限はこの試算に反映していません。</li> : null}
                  </ul></AlertDescription>
                </Alert>
              ) : null}

              <Card className="detail-card">
                <CardHeader><CardTitle>仕入先別の影響</CardTitle><CardDescription>「登録事業者なら」の差が大きい順です。差額は{isAnnualized ? '年間換算' : 'CSV期間'}で表示しています。</CardDescription></CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader><TableRow><TableHead>仕入先</TableHead><TableHead className="text-right">対象仕入</TableHead><TableHead className="text-right">件数</TableHead><TableHead className="text-right">登録なら回避可能{isAnnualized ? '（年換算）' : ''}</TableHead></TableRow></TableHeader>
                    <TableBody>{result.bySupplier.slice(0, 10).map((supplier) => (
                      <TableRow key={supplier.partner}><TableCell className="max-w-[260px] truncate font-medium">{supplier.partner}</TableCell><TableCell className="text-right tabular-nums">{formatYen(supplier.grossAmount)}</TableCell><TableCell className="text-right tabular-nums">{supplier.transactionCount}</TableCell><TableCell className="text-right font-semibold tabular-nums text-[var(--teal-strong)]">{formatYen(supplier.registeredBenefit * displayFactor)}</TableCell></TableRow>
                    ))}</TableBody>
                  </Table>
                </CardContent>
              </Card>

              <div className="code-grid">
                {tkcContextPack.affectedTaxCodes.map((code) => {
                  const item = result.byCode.find((summary) => summary.code === code);
                  return <div className="code-card" key={code}><Badge variant="outline">課税区分 {code}</Badge><strong>{formatYen(item?.grossAmount ?? 0)}</strong><p>{tkcContextPack.taxCodeLabels[code]}</p></div>;
                })}
              </div>

              <Card className="assumption-card">
                <CardHeader><CardTitle>この試算で分かること</CardTitle></CardHeader>
                <CardContent className="assumption-grid">
                  <div><CheckCircle2 /><span><strong>分かる</strong>経過措置率の変更による仕入控除税額の減少見込</span></div>
                  <div><AlertTriangle /><span><strong>別途確認</strong>売上税額、端数処理、帳簿・請求書の保存要件、棚卸調整</span></div>
                  <div><ShieldCheck /><span><strong>計算の前提</strong>価格・取引条件が同じ場合の消費税上の比較</span></div>
                </CardContent>
              </Card>
            </>
          ) : null}
        </section>
      </div>

      <footer className="site-footer">
        <div>
          <span>© 2026</span>
          <a href="https://www.matsumoto-kaikei.or.jp/" target="_blank" rel="license noopener noreferrer">税理士法人松本会計事務所</a>
          <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="license noopener noreferrer">CC BY-NC-SA 4.0</a>
          <a href="https://takatrp.github.io/tool-portal/terms.html" target="_blank" rel="noopener noreferrer">利用条件</a>
          <span>{appMeta.version} / 更新日 {appMeta.updatedAt}</span>
          <span>制度基準日 {appMeta.lawBasisDate}</span>
          <strong>制度資料</strong>
          <a href="https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/invoice-review/index.htm" target="_blank" rel="noopener noreferrer">国税庁・令和8年度税制改正特集</a>
          <a href="https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/pdf/qa/01-01.pdf" target="_blank" rel="noopener noreferrer">国税庁・インボイス制度Q&amp;A</a>
        </div>
        <p>本ツールは税額確定ではなく、一般課税における影響把握のための概算です。申告時は帳簿と適用要件を確認してください。</p>
      </footer>
    </main>
  );
}
