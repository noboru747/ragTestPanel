import os
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from playwright.async_api import async_playwright

router = APIRouter()

TEMPLATES_DIR = os.path.join(os.path.dirname(__file__), "..", "templates")


# ── Pydantic 資料模型 ──────────────────────────────────────────────────────────

class SummaryItem(BaseModel):
    category: str
    description: str
    content: str


class WorkItem(BaseModel):
    title: str
    content: str


class ProjectOverview(BaseModel):
    projectName: str
    scope: str
    objectives: List[str]
    workItems: List[WorkItem]


class Role(BaseModel):
    title: str
    count: int
    duties: str
    qualifications: str


class HrPlan(BaseModel):
    teamStructure: str
    totalEngineers: int
    roles: List[Role]
    qualityManagement: str


class Experience(BaseModel):
    client: str
    project: str
    period: str
    amount: str


class CompanyProfile(BaseModel):
    established: str
    capital: str
    employees: str
    introduction: str
    experiences: List[Experience]


class PricingItem(BaseModel):
    item: str
    unit: str
    quantity: int
    unitPrice: str
    subtotal: str


class Pricing(BaseModel):
    basis: str
    items: List[PricingItem]
    totalAmount: str


class InsertedImage(BaseModel):
    id: str
    src: str
    caption: Optional[str] = None
    width: str = "100%"
    align: str = "center"


class ProposalRequest(BaseModel):
    courtName: str
    caseTitle: str
    caseCode: Optional[str] = ""
    companyName: str
    companyAddress: Optional[str] = ""
    contactPerson: Optional[str] = ""
    contactPhone: Optional[str] = ""
    submissionDate: Optional[str] = ""
    summary: List[SummaryItem]
    projectOverview: ProjectOverview
    hrPlan: HrPlan
    companyProfile: CompanyProfile
    pricing: Pricing
    images: List[InsertedImage] = []


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("")
def generate_pdf(data: ProposalRequest):
    from jinja2 import Environment, FileSystemLoader
    from weasyprint import HTML

    env = Environment(loader=FileSystemLoader(TEMPLATES_DIR))
    template = env.get_template("proposal.html")
    # 把 images 列表轉成 {slotId: [image, ...]} 的 dict
    images_by_slot: dict = {}
    for img in data.images:
        images_by_slot.setdefault(img.id, []).append(img.model_dump())

    html_content = template.render(
        data=data.model_dump(),
        images=images_by_slot,
    )

    pdf_bytes = HTML(string=html_content, base_url=TEMPLATES_DIR).write_pdf()

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": "inline; filename=proposal.pdf"},
    )


# ── Playwright HTML → PDF ──────────────────────────────────────────────────────

@router.post("/from-html")
async def generate_pdf_from_html(payload: dict):
    """接收完整 HTML 字串，用 Playwright Chromium 渲染後回傳 PDF binary。
    Request body: { "html": "<完整 HTML>", "filename": "optional.pdf" }
    """
    html = payload.get("html", "")
    if not html:
        raise HTTPException(status_code=422, detail="html is required")

    filename = payload.get("filename", "proposal.pdf")

    async with async_playwright() as p:
        browser = await p.chromium.launch()
        try:
            page = await browser.new_page()
            await page.emulate_media(media="print")
            await page.set_content(html, wait_until="domcontentloaded")
            pdf_bytes = await page.pdf(
                format="A4",
                print_background=True,
                margin={"top": "2cm", "right": "2.5cm", "bottom": "2.5cm", "left": "2.5cm"},
            )
        finally:
            await browser.close()

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename={filename}"},
    )
