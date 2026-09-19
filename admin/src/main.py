from typing import List
from fastapi import FastAPI, Request, HTTPException, status
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from pydantic_settings import BaseSettings, SettingsConfigDict
import httpx
import os
from dotenv import load_dotenv
from pathlib import Path
import uvicorn
load_dotenv()


class Settings(BaseSettings):
    backend_url: str = os.getenv("BACKEND_URL")
    internal_token: str = os.getenv("INTERNAL_TOKEN")
    port: int = int(os.getenv("PORT", 8000))

    model_config = SettingsConfigDict(
        env_file=".env", 
        env_file_encoding="utf-8", 
        extra="ignore"
    )


settings = Settings()
app = FastAPI(title="Page Admin Panel")

templates = Jinja2Templates(directory=Path(__file__).parent / "templates")


class PagePayload(BaseModel):
    url: str
    title: str
    author: str
    description: str
    content: str
    links: List[str]


@app.get("/", response_class=HTMLResponse)
async def render_admin_page(request: Request):
    return templates.TemplateResponse(name="index.html", request=request)


@app.post("/api/pages")
async def create_page(payload: PagePayload):
    headers = {
        "Content-Type": "application/json",
        "X-Internal-Token": settings.internal_token,
    }

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            response = await client.post(
                settings.backend_url,
                json=payload.model_dump(),
                headers=headers,
            )

            if response.is_success:
                try:
                    data = response.json()
                except Exception:
                    data = response.text
                return {"status": "success", "data": data}
            else:
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"Бэкенд вернул ошибку ({response.status_code}): {response.text}"
                )
        except httpx.RequestError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Не удалось связаться с бэкендом: {str(exc)}"
            )

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=settings.port, reload=True)
