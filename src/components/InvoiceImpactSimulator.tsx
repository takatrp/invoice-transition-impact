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
  Printer,
  RefreshCcw,
  ShieldCheck,
  UploadCloud,
} from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription, DialogClose } from '@/components/ui/dialog';
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
  parseCsvWithMeta,
  readCsvFile,
} from '@/src/domain/csv';
import { getResultStatus } from '@/src/domain/result-status';
import {
  classifyImpact,
  getTransitionStage,
  rateLabel,
  transitionRateOptions,
} from '@/src/domain/rates';
import { registerInvoiceComparisonTool } from '@/src/domain/webmcp';
import type {
  AnalysisSettings,
  CalculationMethod,
  CsvData,
  EntryMapping,
  RatePreset,
} from '@/src/domain/types';

function localToday(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

function createDefaultSettings(): AnalysisSettings {
  const stage = getTransitionStage(localToday());
  return {
    beforeRate: stage.currentRate,
    afterRate: stage.nextRate ?? stage.currentRate,
    amountMode: 'included',
    defaultTaxRate: 10,
    calculationMethod: 'full',
    taxableSalesRatio: 1,
  };
}

const sampleText = `取引年月日,課税区分,税込金額,税率,取引先,摘要
2026/04/15,52,"1,100,000",10%,西日本デザイン,業務委託料
2026/05/20,62,"330,000",10%,みなと管理,賃借関連費
2026/06/10,72,"540,000",8%,神戸フーズ,会議用飲食料品
2026/07/01,5,"220,000",10%,登録済み商事,対象外の仕入れ`;

function createSampleCsv(): CsvData {
  const parsed = parseCsvWithMeta(sampleText);
  return {
    fileName: 'サンプル仕訳.csv',
    encoding: 'UTF-8',
    headers: parsed.rows[0],
    rows: parsed.rows.slice(1),
    rowStartLines: parsed.startLines.slice(1),
  };
}

function formatDate(value: string | null): string {
  return value ? value.replace(/-/g, '/') : '日付列なし';
}

function impactHeading(value: number): string {
  const direction = classifyImpact(value);
  if (direction === 'decrease') return '納付減少・還付増加の見込';
  if (direction === 'none') return '仕入控除税額への直接影響';
  return '納付増加・還付減少の見込';
}

function invalidReason(reason: 'amount_missing' | 'amount_invalid'): string {
  return reason === 'amount_missing' ? '金額が空欄' : '金額の形式が不正';
}

function calculationMethodLabel(method: CalculationMethod): string {
  if (method === 'individual') return '個別対応方式';
  if (method === 'proportional') return '一括比例配分方式';
  if (method === 'simplified') return '簡易課税等（実額仕入の直接影響なし）';
  return '全額控除';
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
            {value === null ? (optional ? '使用しない' : '未設定') : csvHeaderLabel(headers, value)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">{optional ? '使用しない' : '未設定'}</SelectItem>
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
  const [settings, setSettings] = useState<AnalysisSettings>(() => createDefaultSettings());
  const [isSample, setIsSample] = useState(true);
  const [displayMode, setDisplayMode] = useState<'period' | 'annualized'>('annualized');
  const [periodInput, setPeriodInput] = useState({
    start: '',
    end: '',
  });
  const [detailPage, setDetailPage] = useState(0);
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
  const periodSpan = spanDays(periodInput.start || null, periodInput.end || null);
  const periodValid = periodSpan !== null && periodSpan > 0;
  const shortPeriod = periodSpan !== null && periodSpan < 300;
  const annualizedResult = useMemo(
    () => (
      mappingComplete && periodValid
        ? analyzeCsv(csv, mappings, settings, {
            start: periodInput.start,
            end: periodInput.end,
          })
        : null
    ),
    [csv, mappingComplete, mappings, periodInput.end, periodInput.start, periodValid, settings],
  );
  const annualizationReady = Boolean(
    annualizedResult
      && annualizedResult.targetEntries.length > 0,
  );
  const isAnnualized = displayMode === 'annualized' && annualizationReady;
  const displayResult = isAnnualized && annualizedResult ? annualizedResult : result;
  const displayFactor = isAnnualized && periodSpan ? 365 / periodSpan : 1;
  const maxScenario = displayResult
    ? Math.max(
        Math.abs(displayResult.beforeCredit),
        Math.abs(displayResult.afterCredit),
        Math.abs(displayResult.registeredCredit),
      )
    : 0;
  const transitionStage = useMemo(() => getTransitionStage(localToday()), []);
  const scheduleRates: RatePreset[] = [0.8, 0.7, 0.5, 0.3, 0];
  const currentScheduleIndex = scheduleRates.indexOf(transitionStage.currentRate);
  const laterRates = scheduleRates.slice(currentScheduleIndex + 2);
  const resultStatus = displayResult
    ? getResultStatus(displayResult, {
        isAnnualized,
        annualizationFactor: displayFactor,
      })
    : null;
  const printReady = Boolean(
    result
      && displayResult
      && resultStatus
      && displayResult.targetEntries.length > 0,
  );
  const printSupplierRows = displayResult?.bySupplier.slice(0, 5) ?? [];
  const printPeriodLabel = result
    ? isAnnualized
      ? `${formatDate(periodInput.start)} ～ ${formatDate(periodInput.end)}`
      : `${formatDate(result.sourceDateMin)} ～ ${formatDate(result.sourceDateMax)}`
    : '－';
  const detailRows = useMemo(() => {
    if (!result) return [];
    return [
      ...result.targetEntries.map((entry) => ({ kind: 'valid' as const, sourceRow: entry.sourceRow, sourceRecord: entry.sourceRecord, entry })),
      ...result.invalidTargetEntries.map((entry) => ({ kind: 'invalid' as const, sourceRow: entry.sourceRow, sourceRecord: entry.sourceRecord, entry })),
    ].sort((left, right) => left.sourceRow - right.sourceRow || left.sourceRecord - right.sourceRecord);
  }, [result]);
  const detailPageSize = 25;
  const detailPageCount = Math.max(1, Math.ceil(detailRows.length / detailPageSize));
  const visibleDetailRows = detailRows.slice(
    detailPage * detailPageSize,
    (detailPage + 1) * detailPageSize,
  );
  const periodIssueByEntry = useMemo(() => new Map(
    (annualizedResult?.periodExcludedEntries ?? []).map((entry) => [
      `${entry.sourceRow}-${entry.mappingLabel}`,
      entry.reason,
    ]),
  ), [annualizedResult]);

  useEffect(
    () => registerInvoiceComparisonTool(setSettings),
    [],
  );

  useEffect(() => {
    if (!result) return;
    setPeriodInput({
      start: result.sourceDateMin ?? '',
      end: result.sourceDateMax ?? '',
    });
    setDisplayMode(result.sourceDateMin && result.sourceDateMax ? 'annualized' : 'period');
    setDetailPage(0);
  }, [csv, mappings]);

  useEffect(() => {
    if (!annualizationReady && displayMode === 'annualized') setDisplayMode('period');
  }, [annualizationReady, displayMode]);

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
    setSettings(createDefaultSettings());
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
          <div className="brand-copy">
            <p>松本会計ツール</p>
            <h1>インボイス経過措置 影響シミュレーター</h1>
            <span className="header-lead">仕訳CSVから経過措置率の変更と登録事業者との差を概算します。</span>
          </div>
        </a>
        <div className="header-actions">
          <div className="privacy-pill">
            <LockKeyhole />
            CSVは端末内だけで処理
          </div>
          <Button
            type="button"
            className="print-button"
            disabled={!printReady}
            title={printReady ? '印刷画面からPDFとして保存できます' : '試算結果が表示されると印刷できます'}
            onClick={() => window.print()}
          >
            <Printer />
            印刷/PDF
          </Button>
          <span className="header-version">{appMeta.version}</span>
        </div>
      </header>

      <section className="transition-strip" aria-label="経過措置の変更">
        <div>
          <span>現在</span>
          <strong>{rateLabel(transitionStage.currentRate)}</strong>
          <small>{transitionStage.currentEndsOn ? `～${transitionStage.currentEndsOn.slice(0, 7).replace('-', '.')}` : '最終段階'}</small>
        </div>
        <ArrowRight aria-hidden="true" />
        <div className="active">
          <span>次の変更</span>
          <strong>{transitionStage.nextRate === null ? '変更なし' : rateLabel(transitionStage.nextRate)}</strong>
          <small>{transitionStage.nextStartsOn ? `${transitionStage.nextStartsOn.slice(0, 7).replace('-', '.')}～` : '現行日程の最終'}</small>
        </div>
        <ArrowRight aria-hidden="true" />
        <div>
          <span>その後</span>
          <strong>{laterRates.length > 0 ? laterRates.map(rateLabel).join(' → ') : '0％'}</strong>
          <small>段階的に縮小</small>
        </div>
        <p>{appMeta.calculationRuleLabel}</p>
      </section>

      <div className="workspace-grid">
        <aside className="control-column">
          <Dialog>
          <Card className="upload-card">
            <CardHeader>
              <div className="upload-heading-row">
                <div className="section-kicker">手順 1</div>
                <DialogTrigger render={<Button size="sm" className="csv-guide-button" />}>
                  <FileSpreadsheet />CSV切出方法
                </DialogTrigger>
              </div>
              <CardTitle className="text-lg">仕訳CSVを入れる</CardTitle>
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

                <DialogContent className="csv-guide-dialog" showCloseButton={false}>
                  <div className="flex items-center justify-between gap-4">
                    <DialogTitle>仕訳CSVの切出方法</DialogTitle>
                    <DialogClose render={<Button variant="outline" size="sm" />}>閉じる</DialogClose>
                  </div>
                  <DialogDescription>①仕訳帳を開く → ②対象期間を選ぶ → ③虫眼鏡で表示 → ④CSV出力</DialogDescription>
                  <a href="./csv-export-guide.png" target="_blank" rel="noopener noreferrer" aria-label="手順画像を原寸で開く（別タブ）">
                    <img src="./csv-export-guide.png" alt="TKC仕訳帳で対象期間を指定して検索し、右上のCSV出力ボタンから仕訳CSVを切り出す手順" className="w-full h-auto" />
                  </a>
                  <p className="text-sm text-muted-foreground">画像をクリックすると別タブで原寸表示できます。</p>
                </DialogContent>

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
                        <ColumnSelect label="CSV税額（検算用）" value={mapping.taxAmountIndex} headers={csv.headers} optional onChange={(value) => updateMapping(index, { taxAmountIndex: value })} />
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

          </Dialog>
          <Card className="settings-card">
            <CardHeader>
              <div className="section-kicker">手順 2</div>
              <CardTitle className="text-lg">試算の前提</CardTitle>
              <CardDescription>変更前後の割合を選ぶだけで、影響額をすぐ比較できます。</CardDescription>
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

              <div className="period-confirmation">
                <span className="field-label">CSVの集計対象期間</span>
                <div className="period-inputs">
                  <label>
                    <span>開始日</span>
                    <input
                      type="date"
                      value={periodInput.start}
                      onChange={(event) => {
                        setPeriodInput((current) => ({ ...current, start: event.target.value }));
                      }}
                    />
                  </label>
                  <label>
                    <span>終了日</span>
                    <input
                      type="date"
                      value={periodInput.end}
                      onChange={(event) => {
                        setPeriodInput((current) => ({ ...current, end: event.target.value }));
                      }}
                    />
                  </label>
                </div>
                <small>取引日から自動設定：{formatDate(result?.sourceDateMin ?? null)}〜{formatDate(result?.sourceDateMax ?? null)}。必要に応じて修正できます。</small>
                {shortPeriod && periodSpan ? (
                  <small className="period-note is-warning">{periodSpan}日間の実績を365日換算します。短い期間ほど月ごとの偏りが出やすい概算です。</small>
                ) : null}
              </div>

              <div>
                <span className="field-label">金額の表示</span>
                <RadioGroup value={isAnnualized ? 'annualized' : 'period'} onValueChange={(value) => setDisplayMode(value as 'period' | 'annualized')} className="display-mode">
                  <label className="display-option" htmlFor="display-period">
                    <RadioGroupItem id="display-period" value="period" />
                    <span><strong>CSV期間</strong><small>読込期間内の実績</small></span>
                  </label>
                  <label className="display-option" htmlFor="display-annualized">
                    <RadioGroupItem id="display-annualized" value="annualized" disabled={!annualizationReady} />
                    <span><strong>年間換算</strong><small>{annualizationReady && periodSpan ? `${periodSpan}日から365日へ自動換算` : '取引日の読取が必要'}</small></span>
                  </label>
                </RadioGroup>
              </div>

              <div>
                <span className="field-label">仕入控除税額の計算方法</span>
                <RadioGroup value={settings.calculationMethod} onValueChange={(value) => {
                  setSettings((current) => ({ ...current, calculationMethod: value as CalculationMethod }));
                }} className="method-grid">
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
                  <Select value={settings.amountMode} onValueChange={(value) => {
                    setSettings((current) => ({ ...current, amountMode: value as AnalysisSettings['amountMode'] }));
                  }}>
                    <SelectTrigger className="h-10 w-full bg-white" aria-label="CSV金額の税込・税抜"><SelectValue>{settings.amountMode === 'included' ? '税込' : '税抜（純粋な本体金額）'}</SelectValue></SelectTrigger>
                    <SelectContent><SelectItem value="included">税込（推奨）</SelectItem><SelectItem value="excluded">税抜（純粋な本体金額）</SelectItem></SelectContent>
                  </Select>
                  {settings.amountMode === 'excluded' ? <small className="tax-excluded-note">「税抜」は、控除対象外消費税等を含まない純粋な本体金額に限ります。税抜経理で費用・資産へ計上された金額をそのまま使用できない場合があります。可能な場合は税込支払総額を使用してください。</small> : null}
                </div>
                <div className="select-field">
                  <span>税率がない行</span>
                  <Select value={String(settings.defaultTaxRate)} onValueChange={(value) => {
                    setSettings((current) => ({ ...current, defaultTaxRate: Number(value) as 8 | 10 }));
                  }}>
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
          ) : result && result.detectedTargetCount === 0 ? (
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
          ) : result && result.targetEntries.length === 0 ? (
            <div className="empty-result">
              <AlertTriangle />
              <h2>対象コードを{result.detectedTargetCount.toLocaleString('ja-JP')}件検出しましたが、金額を読めませんでした</h2>
              <p>開始行 {result.invalidTargetEntries.slice(0, 20).map((entry) => `${entry.sourceRow}（データ行${entry.sourceRecord}）`).join('、')}{result.invalidTargetEntries.length > 20 ? ' ほか' : ''} の金額列を確認してください。</p>
              <Alert className="empty-warning">
                <AlertTriangle />
                <AlertTitle>計算できない対象行</AlertTitle>
                <AlertDescription>
                  {result.invalidTargetEntries.slice(0, 20).map((entry) => (
                    <div key={`${entry.sourceRow}-${entry.sourceRecord}-${entry.mappingLabel}`}>開始行{entry.sourceRow}（データ行{entry.sourceRecord}）・{entry.mappingLabel}・課税区分{entry.taxCode}：{invalidReason(entry.reason)}</div>
                  ))}
                </AlertDescription>
              </Alert>
            </div>
          ) : result && displayResult ? (
            <>
              <div className="result-heading">
                <div>
                  <div className={`result-status ${resultStatus?.isReference ? 'is-warning' : ''}`}>
                    {resultStatus?.isReference ? <AlertTriangle /> : <CheckCircle2 />}
                    {resultStatus?.label}
                  </div>
                  <h2>経過措置の変更による影響</h2>
                  <p>{displayResult.targetEntries.length.toLocaleString('ja-JP')}件・集計対象仕入 {formatYen(displayResult.grossAmount)}</p>
                </div>
                <div className="period-chip">
                  <span>{isAnnualized ? '年間換算の集計期間' : 'CSVで観測した取引日範囲'}</span>
                  <strong>{isAnnualized ? `${formatDate(periodInput.start)} — ${formatDate(periodInput.end)}` : `${formatDate(result.sourceDateMin)} — ${formatDate(result.sourceDateMax)}`}</strong>
                </div>
              </div>

              <div className="result-premise">
                <strong>計算前提</strong>
                <span>{calculationMethodLabel(settings.calculationMethod)}</span>
                {(settings.calculationMethod === 'individual' || settings.calculationMethod === 'proportional') ? <span>課税売上割合 {Math.round(settings.taxableSalesRatio * 1000) / 10}％</span> : null}
                <span>CSV金額 {settings.amountMode === 'included' ? '税込' : '税抜（純粋な本体金額）'}</span>
                <span>影響把握のための概算</span>
              </div>

              {resultStatus?.supplierLimitReason ? (
                <Alert className="reference-banner">
                  <AlertTriangle />
                  <AlertTitle>1仕入先ごとの控除限度額を反映していない参考値です</AlertTitle>
                  <AlertDescription>{resultStatus.supplierLimitReason === 'annualized'
                    ? '集計期間の仕入を年換算すると、税込支払総額が1億円を超える見込みの仕入先があります。年換算は傾向把握のための推計です。実際の課税期間の金額を確認し、別途上限計算を行ってください。'
                    : '税込支払総額が1億円を超える仕入先を検出しました。この限度額は2026年10月1日以後に開始する課税期間から適用されます。課税期間の開始日などを確認し、別途上限計算を行ってください。'}</AlertDescription>
                </Alert>
              ) : null}

              <div className="impact-hero">
                <div className="impact-copy">
                  <span>{rateLabel(settings.beforeRate)} → {rateLabel(settings.afterRate)}・{isAnnualized ? '年間換算' : 'CSV期間'}</span>
                  <h3>{impactHeading(displayResult.transitionImpact)}</h3>
                  {isAnnualized && periodSpan ? (
                    <p>{periodSpan}日間の実績から365日へ換算した概算です。</p>
                  ) : (
                    <p>CSV期間内の対象仕訳から計算した概算です。</p>
                  )}
                </div>
                <strong className="impact-amount">{formatYen(Math.abs(displayResult.transitionImpact * displayFactor))}</strong>
              </div>

              <div className="scenario-grid">
                <ScenarioCard eyebrow="変更前" rate={rateLabel(settings.beforeRate)} amount={displayResult.beforeCredit * displayFactor} tone="before" max={maxScenario * displayFactor} />
                <ScenarioCard eyebrow="変更後" rate={rateLabel(settings.afterRate)} amount={displayResult.afterCredit * displayFactor} tone="after" max={maxScenario * displayFactor} />
                <ScenarioCard eyebrow="登録事業者との比較" rate="100％" amount={displayResult.registeredCredit * displayFactor} tone="registered" max={maxScenario * displayFactor} />
              </div>

              <div className="registered-callout">
                <div className="callout-icon"><Building2 /></div>
                <div>
                  <span>同じ税込価格で、適格請求書を保存できる前提</span>
                  <h3>変更後の未登録仕入先と登録事業者との仕入控除税額差 {formatYen(displayResult.registeredBenefit * displayFactor)}</h3>
                  <p>{isAnnualized ? '年間換算で、' : 'CSV期間内で、'}同一価格・同一取引条件を仮定した税額上の比較です。登録判断や値引条件の推奨ではありません。</p>
                </div>
              </div>

              <div className="kpi-grid">
                <div><span>元CSV</span><strong>{result.sourceRowCount.toLocaleString('ja-JP')}行</strong></div>
                <div><span>検出対象</span><strong>{result.detectedTargetCount.toLocaleString('ja-JP')}件</strong></div>
                <div><span>対象外</span><strong>{result.ignoredRowCount.toLocaleString('ja-JP')}行</strong></div>
                <div><span>仕入税額相当</span><strong>{formatYen(displayResult.taxEquivalent)}</strong></div>
              </div>

              {(resultStatus?.isReference
                || result.csvTaxAmountCount > 0
                || result.sourceDateUnreadableRowCount > 0
                || (isAnnualized && (displayResult.periodExcludedEntries.length > 0 || shortPeriod))) ? (
                <Alert className="review-alert">
                  <AlertTriangle />
                  <AlertTitle>概算に含まれる注意点</AlertTitle>
                  <AlertDescription><ul>
                    {result.invalidTargetRowCount > 0 ? <li>金額を読めなかった対象明細が{result.invalidTargetRowCount}件あります。開始物理行とデータ行は下の明細で確認できます。</li> : null}
                    {displayResult.assumedRateCount > 0 ? <li>税率を取得できない{displayResult.assumedRateCount}件は、既定の{settings.defaultTaxRate}％で計算した参考値です。</li> : null}
                    {resultStatus?.supplierLimitReason === 'annualized' ? <li>仕入先別の税込支払総額も同じ倍率で年換算すると、1億円を超える見込みの仕入先があります。表示額には控除限度額を反映していません。</li> : null}
                    {resultStatus?.supplierLimitReason === 'period' ? <li>税込支払総額が1億円を超える仕入先があります。表示額には控除限度額を反映していません。</li> : null}
                    {result.csvTaxAmountCount > 0 ? <li>CSV税額は経過措置適用後の値の場合があるため計算には使わず、取引金額と税率から100％相当額を算出しています。</li> : null}
                    {result.sourceDateUnreadableRowCount > 0 ? <li>日付の形式を読めないCSVデータが{result.sourceDateUnreadableRowCount}行あります。</li> : null}
                    {isAnnualized && displayResult.periodExcludedEntries.filter((entry) => entry.reason === 'date_missing_or_invalid').length > 0 ? <li>日付を読めない対象明細を{displayResult.periodExcludedEntries.filter((entry) => entry.reason === 'date_missing_or_invalid').length}件、年換算の分子から除外しました。</li> : null}
                    {isAnnualized && displayResult.periodExcludedEntries.filter((entry) => entry.reason === 'outside_period').length > 0 ? <li>設定した集計期間外の対象明細を{displayResult.periodExcludedEntries.filter((entry) => entry.reason === 'outside_period').length}件、年換算の分子から除外しました。</li> : null}
                    {isAnnualized && shortPeriod && periodSpan ? <li>{periodSpan}日間の仕入構成が一年続くと仮定して、「期間の影響 × 365 ÷ {periodSpan}」で年換算しています。</li> : null}
                  </ul></AlertDescription>
                </Alert>
              ) : null}

              <Card className="detail-card">
                <CardHeader>
                  <CardTitle>仕入先別の影響</CardTitle>
                  <CardDescription>全{displayResult.bySupplier.length.toLocaleString('ja-JP')}仕入先を表示。対象仕入は年換算前の集計期間額、差額は{isAnnualized ? '年間換算' : 'CSV期間'}です。</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader><TableRow><TableHead>仕入先</TableHead><TableHead className="text-right">対象仕入（年換算前）</TableHead><TableHead className="text-right">件数</TableHead><TableHead className="text-right">{rateLabel(settings.beforeRate)}→{rateLabel(settings.afterRate)}の差{isAnnualized ? '（年換算）' : ''}</TableHead><TableHead className="text-right">{rateLabel(settings.afterRate)}→100％の差{isAnnualized ? '（年換算）' : ''}</TableHead></TableRow></TableHeader>
                    <TableBody>{displayResult.bySupplier.map((supplier) => (
                      <TableRow key={supplier.partner}><TableCell className="max-w-[260px] truncate font-medium">{supplier.partner}</TableCell><TableCell className="text-right tabular-nums">{formatYen(supplier.grossAmount)}</TableCell><TableCell className="text-right tabular-nums">{supplier.transactionCount}</TableCell><TableCell className="text-right font-semibold tabular-nums">{formatYen(supplier.transitionImpact * displayFactor)}</TableCell><TableCell className="text-right font-semibold tabular-nums text-[var(--teal-strong)]">{formatYen(supplier.registeredBenefit * displayFactor)}</TableCell></TableRow>
                    ))}</TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card className="detail-card entry-detail-card">
                <CardHeader>
                  <CardTitle>元仕訳の検算明細</CardTitle>
                  <CardDescription>対象・計算除外を合わせて{detailRows.length.toLocaleString('ja-JP')}件。開始物理行はCSVテキスト上のレコード開始位置、データ行は空行を除いた見出し後の通し番号です。セル内改行がある場合、Excel上の行番号とは一致しないことがあります。</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader><TableRow><TableHead>開始物理行</TableHead><TableHead>データ行</TableHead><TableHead>日付</TableHead><TableHead>側</TableHead><TableHead>区分</TableHead><TableHead className="text-right">{settings.amountMode === 'included' ? '税込支払額' : '税抜本体額'}</TableHead><TableHead className="text-right">税率</TableHead><TableHead className="text-right">100％税額相当</TableHead><TableHead className="text-right">CSV税額</TableHead><TableHead>算定根拠・状態</TableHead></TableRow></TableHeader>
                    <TableBody>{visibleDetailRows.map((row) => row.kind === 'valid' ? (
                      <TableRow key={`valid-${row.entry.sourceRow}-${row.entry.sourceRecord}-${row.entry.mappingLabel}`}>
                        <TableCell>{row.entry.sourceRow}</TableCell><TableCell>{row.entry.sourceRecord}</TableCell><TableCell>{formatDate(row.entry.date)}</TableCell><TableCell>{row.entry.mappingLabel}</TableCell><TableCell>{row.entry.taxCode}</TableCell><TableCell className="text-right tabular-nums">{formatYen(row.entry.amount)}</TableCell><TableCell className="text-right">{row.entry.taxRate}％{row.entry.rateAssumed ? '（既定）' : ''}</TableCell><TableCell className="text-right tabular-nums">{formatYen(row.entry.taxEquivalent)}</TableCell><TableCell className="text-right tabular-nums">{row.entry.csvTaxAmount === null ? '—' : formatYen(row.entry.csvTaxAmount)}</TableCell><TableCell>{periodIssueByEntry.get(`${row.entry.sourceRow}-${row.entry.mappingLabel}`) === 'outside_period' ? '年換算除外：集計期間外' : periodIssueByEntry.get(`${row.entry.sourceRow}-${row.entry.mappingLabel}`) === 'date_missing_or_invalid' ? '年換算除外：日付不明' : '取引金額＋税率'}</TableCell>
                      </TableRow>
                    ) : (
                      <TableRow key={`invalid-${row.entry.sourceRow}-${row.entry.sourceRecord}-${row.entry.mappingLabel}`} className="invalid-detail-row">
                        <TableCell>{row.entry.sourceRow}</TableCell><TableCell>{row.entry.sourceRecord}</TableCell><TableCell>{row.entry.rawDate || '—'}</TableCell><TableCell>{row.entry.mappingLabel}</TableCell><TableCell>{row.entry.taxCode}</TableCell><TableCell className="text-right">{row.entry.rawAmount || '—'}</TableCell><TableCell className="text-right">—</TableCell><TableCell className="text-right">—</TableCell><TableCell className="text-right">—</TableCell><TableCell>計算除外：{invalidReason(row.entry.reason)}</TableCell>
                      </TableRow>
                    ))}</TableBody>
                  </Table>
                  <div className="detail-pagination">
                    <span>{detailPage + 1} / {detailPageCount}ページ（{detailRows.length.toLocaleString('ja-JP')}件）</span>
                    <div><Button size="sm" variant="outline" disabled={detailPage === 0} onClick={() => setDetailPage((current) => Math.max(0, current - 1))}>前へ</Button><Button size="sm" variant="outline" disabled={detailPage >= detailPageCount - 1} onClick={() => setDetailPage((current) => Math.min(detailPageCount - 1, current + 1))}>次へ</Button></div>
                  </div>
                </CardContent>
              </Card>

              <div className="code-grid">
                {tkcContextPack.affectedTaxCodes.map((code) => {
                  const item = displayResult.byCode.find((summary) => summary.code === code);
                  return <div className="code-card" key={code}><Badge variant="outline">課税区分 {code}</Badge><strong>{formatYen(item?.grossAmount ?? 0)}</strong><p>{tkcContextPack.taxCodeLabels[code]}</p></div>;
                })}
              </div>

              <Card className="assumption-card">
                <CardHeader><CardTitle>この試算で分かること</CardTitle></CardHeader>
                <CardContent className="assumption-grid">
                  <div><CheckCircle2 /><span><strong>分かる</strong>経過措置率の変更による仕入控除税額の増減見込</span></div>
                  <div><AlertTriangle /><span><strong>別途確認</strong>売上税額、端数処理、帳簿・請求書の保存要件、棚卸調整</span></div>
                  <div><ShieldCheck /><span><strong>計算の前提</strong>価格・取引条件が同じ場合の消費税上の比較</span></div>
                </CardContent>
              </Card>
            </>
          ) : null}
        </section>
      </div>

      <section className="print-report" aria-label="印刷用試算結果">
        {result && displayResult && resultStatus ? (
          <article className="print-sheet">
            <header className="print-header">
              <img src="./forstaff.png" alt="" />
              <div>
                <p>松本会計ツール</p>
                <h1>インボイス経過措置 影響シミュレーター</h1>
                <span>試算結果サマリー</span>
              </div>
              <div className="print-document-meta">
                <strong>{appMeta.version}</strong>
                <span>出力日 {formatDate(localToday())}</span>
              </div>
            </header>

            <section className="print-source-grid" aria-label="試算条件">
              <div><span>元CSV</span><strong>{csv.fileName}</strong></div>
              <div><span>集計対象期間</span><strong>{printPeriodLabel}</strong></div>
              <div><span>表示区分</span><strong>{isAnnualized ? `年間換算${periodSpan ? `（${periodSpan}日→365日）` : ''}` : 'CSV期間'}</strong></div>
              <div><span>計算方法</span><strong>{calculationMethodLabel(settings.calculationMethod)}</strong></div>
              <div><span>対象</span><strong>{displayResult.targetEntries.length.toLocaleString('ja-JP')}件 / {displayResult.bySupplier.length.toLocaleString('ja-JP')}仕入先</strong></div>
              <div><span>CSV金額</span><strong>{settings.amountMode === 'included' ? '税込' : '税抜（本体金額）'}</strong></div>
            </section>

            <section className={`print-impact ${resultStatus.isReference ? 'is-warning' : ''}`}>
              <div>
                <span>{rateLabel(settings.beforeRate)} → {rateLabel(settings.afterRate)}・{isAnnualized ? '年間換算' : 'CSV期間'}</span>
                <strong>{impactHeading(displayResult.transitionImpact)}</strong>
                <small>{resultStatus.label}</small>
              </div>
              <p>{formatYen(Math.abs(displayResult.transitionImpact * displayFactor))}</p>
            </section>

            <section className="print-scenario-grid" aria-label="仕入控除税額の比較">
              <div><span>変更前 {rateLabel(settings.beforeRate)}</span><strong>{formatYen(displayResult.beforeCredit * displayFactor)}</strong></div>
              <div><span>変更後 {rateLabel(settings.afterRate)}</span><strong>{formatYen(displayResult.afterCredit * displayFactor)}</strong></div>
              <div><span>登録事業者 100％</span><strong>{formatYen(displayResult.registeredCredit * displayFactor)}</strong></div>
            </section>

            <section className="print-registered-benefit">
              <div>
                <span>同一価格・同一取引条件、適格請求書を保存できる前提</span>
                <strong>変更後の未登録仕入先と登録事業者との仕入控除税額差</strong>
              </div>
              <p>{formatYen(displayResult.registeredBenefit * displayFactor)}</p>
            </section>

            <section className="print-suppliers">
              <div className="print-section-heading">
                <h2>仕入先別の影響</h2>
                <span>{displayResult.bySupplier.length > 5 ? `影響額上位5件 / 全${displayResult.bySupplier.length.toLocaleString('ja-JP')}仕入先` : `全${displayResult.bySupplier.length.toLocaleString('ja-JP')}仕入先`}</span>
              </div>
              <table>
                <thead><tr><th>仕入先</th><th>対象仕入（期間額）</th><th>{rateLabel(settings.beforeRate)}→{rateLabel(settings.afterRate)}の差</th><th>{rateLabel(settings.afterRate)}→100％の差</th></tr></thead>
                <tbody>{printSupplierRows.map((supplier) => (
                  <tr key={`print-${supplier.partner}`}>
                    <td>{supplier.partner}</td>
                    <td>{formatYen(supplier.grossAmount)}</td>
                    <td>{formatYen(supplier.transitionImpact * displayFactor)}</td>
                    <td>{formatYen(supplier.registeredBenefit * displayFactor)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </section>

            <section className="print-notes">
              <h2>前提・確認事項</h2>
              <ul>
                <li>課税区分52・62・72を対象に、取引金額と税率から100％の仕入税額相当額を算出しています。</li>
                {isAnnualized && periodSpan ? <li>集計期間の結果を「期間の影響 × 365日 ÷ {periodSpan}日」で年換算しています。</li> : null}
                {displayResult.assumedRateCount > 0 ? <li>税率を取得できない{displayResult.assumedRateCount.toLocaleString('ja-JP')}件は既定の{settings.defaultTaxRate}％で計算しています。</li> : null}
                {resultStatus.missingDateExcludedCount > 0 ? <li>日付不明{resultStatus.missingDateExcludedCount.toLocaleString('ja-JP')}件を年換算の分子から除外しています。</li> : null}
                {resultStatus.supplierLimitReason ? <li>1仕入先ごとの控除限度額を反映していません。実際の課税期間の税込支払総額を別途確認してください。</li> : null}
              </ul>
            </section>

            <footer className="print-footer">
              <p>本ツールは税額確定ではなく、一般課税における影響把握のための概算です。申告時は帳簿、適用要件、端数処理等を確認してください。</p>
              <span>© 2026 税理士法人松本会計事務所 ｜ 制度基準日 {appMeta.lawBasisDate}</span>
            </footer>
          </article>
        ) : null}
      </section>

      <footer className="site-footer">
        <div className="footer-primary">
          <span>© 2026</span>
          <a href="https://www.matsumoto-kaikei.or.jp/" target="_blank" rel="noopener noreferrer">税理士法人松本会計事務所</a>
          <span aria-hidden="true">｜</span>
          <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="license noopener noreferrer">CC BY-NC-SA 4.0</a>
          <span aria-hidden="true">｜</span>
          <a href="https://takatrp.github.io/tool-portal/terms.html" target="_blank" rel="noopener noreferrer">利用条件</a>
          <span aria-hidden="true">｜</span>
          <span>{appMeta.version}</span>
          <span aria-hidden="true">｜</span>
          <span>更新日 {appMeta.updatedAt}</span>
        </div>
        <div className="footer-references">
          <span>制度基準日 {appMeta.lawBasisDate}</span>
          <span aria-hidden="true">｜</span>
          <a href="https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/invoice-review/index.htm" target="_blank" rel="noopener noreferrer">国税庁・令和8年度税制改正特集</a>
          <span aria-hidden="true">｜</span>
          <a href="https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/pdf/qa/01-01.pdf" target="_blank" rel="noopener noreferrer">国税庁・インボイス制度Q&amp;A</a>
        </div>
        <p>本ツールは税額確定ではなく、一般課税における影響把握のための概算です。申告時は帳簿と適用要件を確認してください。</p>
        <p>アクセス状況の把握にGoogle Analyticsを使用しています。CSVの内容・ファイル名・取引先名・試算金額は送信しません。</p>
      </footer>
    </main>
  );
}
