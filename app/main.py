from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .config import get_settings
from .database import create_pool, initialize_database
from .routes import attendance, auth, system, users


BASE_DIR = Path(__file__).resolve().parent
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.pool = await create_pool(settings)
    app.state.settings = settings
    await initialize_database(app.state.pool)

    yield

    await app.state.pool.close()


app = FastAPI(
    title=settings.app_name,
    lifespan=lifespan,
)
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=settings.trusted_host_list,
)


app.mount(
    "/static",
    StaticFiles(directory=BASE_DIR / "static"),
    name="static",
)


templates = Jinja2Templates(directory=BASE_DIR / "templates")


app.include_router(auth.router)
app.include_router(users.router)
app.include_router(system.router)
app.include_router(attendance.router)

@app.get("/health")
async def health(request: Request):
    try:
        await request.app.state.pool.fetchval("SELECT 1")
    except Exception:
        return JSONResponse({"status": "error", "database": "unavailable"}, status_code=503)
    return {"status": "ok", "database": "ok"}

@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="index.html",
    )

@app.get("/login", response_class=HTMLResponse)
@app.get("/register", response_class=HTMLResponse)
async def auth_page(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="auth.html",
        context={"page": request.url.path.removeprefix("/")},
    )