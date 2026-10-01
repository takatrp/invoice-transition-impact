import { Download, ExternalLink, FileCheck2 } from 'lucide-react';

const checklistHref = `${import.meta.env.BASE_URL}docs/invoice-audit-checklist.pdf`;

export function AuditChecklistNotice() {
  return (
    <aside className="audit-checklist-notice" aria-label="巡回監査用チェックシート">
      <div className="audit-checklist-card">
        <div className="audit-checklist-copy">
          <span className="audit-checklist-kicker">巡回監査の前に</span>
          <p>インボイス経過措置の確認ポイントを、1枚のチェックシートにまとめました。</p>
        </div>
        <div className="audit-checklist-actions">
          <a
            className="audit-checklist-button"
            href={checklistHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-describedby="audit-checklist-open-note"
          >
            <FileCheck2 aria-hidden="true" />
            <span>巡回監査時の注意点</span>
            <ExternalLink aria-hidden="true" />
          </a>
          <div className="audit-checklist-secondary">
            <span id="audit-checklist-open-note">PDFを別タブで表示</span>
            <a href={checklistHref} download="インボイス経過措置チェックシート_松本会計.pdf">
              <Download aria-hidden="true" />
              PDFを保存
            </a>
          </div>
        </div>
      </div>
    </aside>
  );
}
