'use client';


export interface ProposalData {
  courtName: string;
  caseTitle: string;
  caseCode: string;
  companyName: string;
  companyAddress: string;
  contactPerson: string;
  contactPhone: string;
  submissionDate: string;
  summary: SummaryItem[];
  projectOverview: ProjectOverview;
  hrPlan: HrPlan;
  companyProfile: CompanyProfile;
  pricing: Pricing;
  pageBreaks?: string[]  // 記錄哪些 slotId 被標記為強制頁末
}

export interface SummaryItem {
  category: string;
  description: string;
  content: string;
}

export interface ProjectOverview {
  projectName: string;
  scope: string;
  objectives: string[];
  workItems: WorkItem[];
}

export interface WorkItem {
  title: string;
  content: string;
}

export interface HrPlan {
  teamStructure: string;
  totalEngineers: number;
  roles: Role[];
  qualityManagement: string;
}

export interface Role {
  title: string;
  count: number;
  duties: string;
  qualifications: string;
}

export interface CompanyProfile {
  established: string;
  capital: string;
  employees: string;
  introduction: string;
  experiences: Experience[];
}

export interface Experience {
  client: string;
  project: string;
  period: string;
  amount: string;
}

export interface Pricing {
  basis: string;
  items: PriceItem[];
  totalAmount: string;
}

export interface PriceItem {
  item: string;
  unit: string;
  quantity: number;
  unitPrice: string;
  subtotal: string;
}

export interface InsertedImage {
  id: string;
  src: string;
  caption?: string;
  width: '25%' | '50%' | '75%' | '100%';
  align: 'left' | 'center' | 'right';
}

interface ProposalDocumentProps {
  data: ProposalData;
  images?: InsertedImage[];
  editMode?: boolean;
  onImageInsert?: (slotId: string, file: File) => void;
  onImageRemove?: (slotId: string, idx: number) => void;
  onImageUpdate?: (slotId: string, idx: number, updates: Partial<InsertedImage>) => void;
  onSectionEdit?: (sectionId: string) => void;
  onPageBreakToggle?: (slotId: string) => void;
  pageNumPos?: 'left' | 'center' | 'right' | 'none';
  showBlankAfterToc?: boolean;
}

const SLOT_LABELS: Record<string, string> = {
  'after-cover': '封面後（Logo、題圖）',
  'after-summary': '摘要表後（服務架構圖）',
  'after-scope': '履約標的後（場域平面圖）',
  'after-workitem-0': '工作要項一後',
  'after-workitem-1': '工作要項二後',
  'after-workitem-2': '工作要項三後',
  'after-workitem-3': '工作要項四後',
  'after-org': '組織說明後（組織架構圖）',
  'after-quality': '品質管理後（PDCA 圖）',
  'after-company-intro': '公司介紹後（實景照、證書）',
  'after-experiences': '實績表後（合約佐證截圖）',
  'after-pricing': '價格分析後',
};

function ImageSlot({
  slotId,
  allImages = [],
  editMode,
  onInsert,
  onRemove,
  onUpdate,
  pageBreaks = [],
  onPageBreakToggle,
}: {
  slotId: string;
  allImages?: InsertedImage[];
  editMode?: boolean;
  onInsert?: (slotId: string, file: File) => void;
  onRemove?: (slotId: string, idx: number) => void;
  onUpdate?: (slotId: string, idx: number, updates: Partial<InsertedImage>) => void;
  pageBreaks?: string[];
  onPageBreakToggle?: (slotId: string) => void;
}) {
  const images = allImages.filter(img => img.id === slotId);
  const hasBreak = pageBreaks.includes(slotId);
  if (!editMode && images.length === 0 && !hasBreak) return null;

  return (
    <div className={`my-4 ${editMode ? 'border border-dashed border-blue-200 rounded-lg p-3' : ''}`}>
      {images.map((img, idx) => (
        <div key={idx} className="mb-4">
          <div style={{ textAlign: img.align }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={img.src}
              alt={img.caption || ''}
              style={{ width: img.width, display: 'inline-block', maxWidth: '100%' }}
            />
          </div>
          {img.caption && (
            <p className="text-xs text-gray-500 mt-1 text-center italic">{img.caption}</p>
          )}
          {editMode && (
            <div className="no-print flex flex-wrap items-center gap-2 mt-2 bg-blue-50 border border-blue-100 rounded p-2">
              <label className="text-xs text-gray-500">寬度</label>
              <select
                value={img.width}
                onChange={e => onUpdate?.(slotId, idx, { width: e.target.value as InsertedImage['width'] })}
                className="text-xs border rounded px-1 py-0.5 bg-white"
              >
                <option value="25%">25%</option>
                <option value="50%">50%</option>
                <option value="75%">75%</option>
                <option value="100%">100%</option>
              </select>
              <label className="text-xs text-gray-500">對齊</label>
              <select
                value={img.align}
                onChange={e => onUpdate?.(slotId, idx, { align: e.target.value as InsertedImage['align'] })}
                className="text-xs border rounded px-1 py-0.5 bg-white"
              >
                <option value="left">靠左</option>
                <option value="center">置中</option>
                <option value="right">靠右</option>
              </select>
              <input
                type="text"
                value={img.caption || ''}
                onChange={e => onUpdate?.(slotId, idx, { caption: e.target.value })}
                placeholder="圖說文字（選填）"
                className="text-xs border rounded px-2 py-0.5 flex-1 min-w-24 bg-white"
              />
              <button
                onClick={() => onRemove?.(slotId, idx)}
                className="text-xs text-red-500 hover:text-red-700 px-2 py-0.5 border border-red-200 rounded bg-white"
              >
                移除
              </button>
            </div>
          )}
        </div>
      ))}

      {editMode && (
        <label className="no-print flex items-center gap-2 cursor-pointer text-xs text-blue-600 hover:text-blue-800 border border-dashed border-blue-300 rounded px-3 py-2 hover:bg-blue-50 transition w-fit">
          <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          + 插入圖片（{SLOT_LABELS[slotId] ?? slotId}）
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) onInsert?.(slotId, file);
              e.target.value = '';
            }}
          />
        </label>
      )}

      {/* 分頁切換按鈕：僅編輯模式顯示 */}
      {editMode && (
        <div className="no-print mt-2 flex">
          <button
            onClick={() => onPageBreakToggle?.(slotId)}
            className={`text-xs px-3 py-1 rounded border transition ${
              hasBreak
                ? 'border-orange-400 text-orange-600 bg-orange-50 hover:bg-orange-100'
                : 'border-dashed border-gray-400 text-gray-500 hover:border-gray-600 hover:text-gray-700'
            }`}
          >
            {hasBreak ? '✕ 取消分頁' : '＋ 在此分頁'}
          </button>
        </div>
      )}

      {/* 強制分頁標記：有標記時不論模式都顯示 */}
      {hasBreak && (
        <div className="break-after-page">
          <div className="no-print -mx-16 mt-4 mb-0 h-8 bg-orange-500 flex items-center justify-center gap-2">
            <span className="text-[10px] text-white tracking-[3px] font-medium">強制分頁</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProposalDocument({ data, images = [], editMode, onImageInsert, onImageRemove, onImageUpdate, onSectionEdit, onPageBreakToggle, pageNumPos = 'center', showBlankAfterToc = false }: ProposalDocumentProps) {
  const EditBtn = ({ id, label }: { id: string; label: string }) =>
    onSectionEdit ? (
      <button
        onClick={() => onSectionEdit(id)}
        className="no-print inline-flex items-center gap-1 ml-2 px-2 py-0.5 text-xs bg-amber-50 hover:bg-amber-100 text-amber-600 border border-amber-200 rounded transition align-middle"
        title={`編輯${label}`}
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
        編輯
      </button>
    ) : null

  const slot = (slotId: string) => (
    <ImageSlot
      slotId={slotId}
      allImages={images}
      editMode={editMode}
      onInsert={onImageInsert}
      onRemove={onImageRemove}
      onUpdate={onImageUpdate}
      pageBreaks={data.pageBreaks}
      onPageBreakToggle={onPageBreakToggle}
    />
  );

  return (
    <>
    <style>{`
      @media print {
        .page { min-height: 0 !important; }
        .page + .page { break-before: page; page-break-before: always; }
      }
    `}</style>
    <div className="proposal-document bg-white text-gray-900 font-serif" style={{ fontFamily: '"標楷體", "DFKai-SB", serif', fontSize: '12pt', lineHeight: '1.8' }}>

      {/* ===== 封面 ===== */}
      <section className="page cover-page flex flex-col items-center justify-center min-h-screen border-b-2 border-gray-300 py-16 print:min-h-screen relative">
        {onSectionEdit && (
          <div className="no-print absolute top-4 right-4">
            <EditBtn id="cover" label="封面資訊" />
          </div>
        )}
        <div className="text-center space-y-4">
          <h1 className="text-3xl font-bold leading-relaxed tracking-wide">
            {data.courtName}<br />
            {data.caseTitle}
          </h1>
          <h2 className="text-4xl font-bold mt-8 tracking-[0.5em]">建議書</h2>
          <div className="mt-12 text-lg space-y-2 text-left inline-block">
            <p>案號：{data.caseCode}</p>
            <p>投標公司：{data.companyName}</p>
            <p>地址：{data.companyAddress}</p>
            <p>聯絡人：{data.contactPerson}</p>
            <p>電話：{data.contactPhone}</p>
          </div>
          <p className="mt-12 text-lg">{data.submissionDate}</p>
        </div>
        {slot('after-cover')}
      </section>

      {/* ===== 目錄 ===== */}
      <section className="page toc-page py-12 px-16 print:page-break-before-always">
        <h2 className="text-2xl font-bold mb-8 border-b-2 border-gray-800 pb-2">目錄</h2>
        <div className="space-y-2 text-base">
          {[
            ['壹、總論', '1'],
            ['　一、建議書摘要表', '1'],
            ['貳、專案概述', '5'],
            ['　一、專案名稱', '5'],
            ['　二、履約標的', '5'],
            ['　三、需求目標', '5'],
            ['　四、履約之工作要項', '7'],
            ['參、專案管理之人力規劃配置', '12'],
            ['　一、執行本專案之組織、分工', '12'],
            ['　二、品質保證管理', '16'],
            ['肆、公司履約實績及經營現況', '20'],
            ['　一、公司基本資料', '20'],
            ['　二、經驗與實績', '20'],
            ['伍、價格分析', '26'],
            ['　一、各項標價分析', '26'],
          ].map(([title, page]) => (
            <div key={title} className="flex justify-between">
              <span>{title}</span>
              <span className="border-b border-dotted border-gray-400 flex-1 mx-2 mb-1" />
              <span>{page}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ===== 目錄後空白頁（選填）===== */}
      {showBlankAfterToc && (
        <section className="page py-12 px-16 print:page-break-before-always" style={{ minHeight: '842px' }}>
        </section>
      )}

      {/* ===== 壹、總論 ===== */}
      <section className="page section-page py-12 px-16 print:page-break-before-always">
        <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
          <span className="bg-gray-800 text-white px-3 py-1">壹</span>
          <span>總論</span>
        </h2>
        <h3 className="text-lg font-bold mb-4">
          一、建議書摘要表<EditBtn id="summary" label="摘要表" />
        </h3>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-gray-200">
              <th className="border border-gray-400 px-3 py-2 w-1/4">評審項目</th>
              <th className="border border-gray-400 px-3 py-2 w-1/3">項目說明</th>
              <th className="border border-gray-400 px-3 py-2">摘要說明</th>
            </tr>
          </thead>
          <tbody>
            {(data.summary ?? []).map((row, i) => (
              <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                <td className="border border-gray-400 px-3 py-2 font-medium">{row.category}</td>
                <td className="border border-gray-400 px-3 py-2">{row.description}</td>
                <td className="border border-gray-400 px-3 py-2 whitespace-pre-line">{row.content}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {slot('after-summary')}
      </section>

      {/* ===== 貳、專案概述 ===== */}
      <section className="page section-page py-12 px-16 print:page-break-before-always">
        <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
          <span className="bg-gray-800 text-white px-3 py-1">貳</span>
          <span>專案概述</span>
        </h2>
        <div className="space-y-6">
          <div>
            <h3 className="text-base font-bold mb-2">一、專案名稱</h3>
            <p className="pl-4">{data.projectOverview?.projectName}</p>
          </div>
          <div>
            <h3 className="text-base font-bold mb-2">
              二、履約標的<EditBtn id="scope" label="履約標的" />
            </h3>
            <p className="pl-4 whitespace-pre-line">{data.projectOverview?.scope}</p>
            {slot('after-scope')}
          </div>
          <div>
            <h3 className="text-base font-bold mb-2">
              三、需求目標<EditBtn id="objectives" label="需求目標" />
            </h3>
            <ul className="pl-8 list-disc space-y-1">
              {(data.projectOverview?.objectives ?? []).map((obj, i) => (
                <li key={i}>{obj}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-base font-bold mb-2">
              四、履約之工作要項<EditBtn id="workItems" label="工作要項" />
            </h3>
            {(data.projectOverview?.workItems ?? []).map((item, i) => (
              <div key={i} className="mb-2">
                <p className="font-medium pl-4">（{['一','二','三','四','五','六','七','八'][i]}）{item.title}</p>
                <p className="pl-8 whitespace-pre-line text-sm">{item.content}</p>
                {slot(`after-workitem-${i}`)}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== 參、人力規劃 ===== */}
      <section className="page section-page py-12 px-16 print:page-break-before-always">
        <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
          <span className="bg-gray-800 text-white px-3 py-1">參</span>
          <span>專案管理之人力規劃配置</span>
        </h2>
        <div className="space-y-6">
          <div>
            <h3 className="text-base font-bold mb-2">
              一、執行本專案之組織、分工<EditBtn id="hrPlan" label="人力配置" />
            </h3>
            <p className="pl-4 mb-4 whitespace-pre-line">{data.hrPlan?.teamStructure}</p>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-gray-200">
                  <th className="border border-gray-400 px-3 py-2">職稱</th>
                  <th className="border border-gray-400 px-3 py-2">人數</th>
                  <th className="border border-gray-400 px-3 py-2">職責</th>
                  <th className="border border-gray-400 px-3 py-2">資格條件</th>
                </tr>
              </thead>
              <tbody>
                {(data.hrPlan?.roles ?? []).map((role, i) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="border border-gray-400 px-3 py-2">{role.title}</td>
                    <td className="border border-gray-400 px-3 py-2 text-center">{role.count}</td>
                    <td className="border border-gray-400 px-3 py-2 whitespace-pre-line">{role.duties}</td>
                    <td className="border border-gray-400 px-3 py-2 whitespace-pre-line">{role.qualifications}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {slot('after-org')}
          </div>
          <div>
            <h3 className="text-base font-bold mb-2">
              二、品質保證管理<EditBtn id="quality" label="品質管理" />
            </h3>
            <p className="pl-4 whitespace-pre-line">{data.hrPlan?.qualityManagement}</p>
            {slot('after-quality')}
          </div>
        </div>
      </section>

      {/* ===== 肆、公司實績 ===== */}
      <section className="page section-page py-12 px-16 print:page-break-before-always">
        <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
          <span className="bg-gray-800 text-white px-3 py-1">肆</span>
          <span>公司履約實績及經營現況</span>
        </h2>
        <div className="space-y-6">
          <div>
            <h3 className="text-base font-bold mb-2">
              一、公司基本資料<EditBtn id="company" label="公司資料" />
            </h3>
            <div className="pl-4 space-y-1 text-sm">
              <p>成立年份：{data.companyProfile?.established}</p>
              <p>資本額：{data.companyProfile?.capital}</p>
              <p>員工人數：{data.companyProfile?.employees}</p>
              <p className="mt-2 whitespace-pre-line">{data.companyProfile?.introduction}</p>
            </div>
            {slot('after-company-intro')}
          </div>
          <div>
            <h3 className="text-base font-bold mb-2">二、經驗與實績</h3>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-gray-200">
                  <th className="border border-gray-400 px-3 py-2">機關/客戶</th>
                  <th className="border border-gray-400 px-3 py-2">專案名稱</th>
                  <th className="border border-gray-400 px-3 py-2">執行期間</th>
                  <th className="border border-gray-400 px-3 py-2">合約金額</th>
                </tr>
              </thead>
              <tbody>
                {(data.companyProfile?.experiences ?? []).map((exp, i) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="border border-gray-400 px-3 py-2">{exp.client}</td>
                    <td className="border border-gray-400 px-3 py-2">{exp.project}</td>
                    <td className="border border-gray-400 px-3 py-2">{exp.period}</td>
                    <td className="border border-gray-400 px-3 py-2">{exp.amount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {slot('after-experiences')}
          </div>
        </div>
      </section>

      {/* ===== 伍、價格分析 ===== */}
      <section className="page section-page py-12 px-16 print:page-break-before-always">
        <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
          <span className="bg-gray-800 text-white px-3 py-1">伍</span>
          <span>價格分析</span>
        </h2>
        <div className="space-y-6">
          <div>
            <h3 className="text-base font-bold mb-2">
              一、本專案所列人力計費標準<EditBtn id="pricing" label="價格分析" />
            </h3>
            <p className="pl-4 text-sm whitespace-pre-line">{data.pricing?.basis}</p>
          </div>
          <div>
            <h3 className="text-base font-bold mb-2">二、各項標價分析</h3>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-gray-200">
                  <th className="border border-gray-400 px-3 py-2">項目</th>
                  <th className="border border-gray-400 px-3 py-2">單位</th>
                  <th className="border border-gray-400 px-3 py-2">數量</th>
                  <th className="border border-gray-400 px-3 py-2">單價</th>
                  <th className="border border-gray-400 px-3 py-2">小計</th>
                </tr>
              </thead>
              <tbody>
                {(data.pricing?.items ?? []).map((item, i) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="border border-gray-400 px-3 py-2">{item.item}</td>
                    <td className="border border-gray-400 px-3 py-2 text-center">{item.unit}</td>
                    <td className="border border-gray-400 px-3 py-2 text-center">{item.quantity}</td>
                    <td className="border border-gray-400 px-3 py-2 text-right">{item.unitPrice}</td>
                    <td className="border border-gray-400 px-3 py-2 text-right">{item.subtotal}</td>
                  </tr>
                ))}
                <tr className="bg-gray-100 font-bold">
                  <td colSpan={4} className="border border-gray-400 px-3 py-2 text-right">合計</td>
                  <td className="border border-gray-400 px-3 py-2 text-right">{data.pricing?.totalAmount}</td>
                </tr>
              </tbody>
            </table>
            {slot('after-pricing')}
          </div>
        </div>
      </section>

    </div>
    </>
  );
}
