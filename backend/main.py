from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import agent, git_router, ocr, documents, query, projects, generate, requests as requests_router, templates as templates_router, feedback as feedback_router, pdf as pdf_router, company_vars as company_vars_router

app = FastAPI(title="RGA KM Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://*.vercel.app"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(agent.router, prefix="/api/agent", tags=["agent"])
app.include_router(git_router.router, prefix="/api/git", tags=["git"])
app.include_router(ocr.router, prefix="/api/ocr", tags=["ocr"])
app.include_router(documents.router, prefix="/api/documents", tags=["documents"])
app.include_router(query.router, prefix="/api/query", tags=["query"])
app.include_router(projects.router, prefix="/api/projects", tags=["projects"])
app.include_router(generate.router, prefix="/api/generate", tags=["generate"])
app.include_router(requests_router.router, prefix="/api/requests", tags=["requests"])
app.include_router(templates_router.router, prefix="/api/templates", tags=["templates"])
app.include_router(feedback_router.router, prefix="/api/feedback", tags=["feedback"])
app.include_router(pdf_router.router, prefix="/api/generate/pdf", tags=["pdf"])
app.include_router(company_vars_router.router, prefix="/api/company-vars", tags=["company-vars"])


@app.get("/health")
async def health():
    return {"status": "ok"}
