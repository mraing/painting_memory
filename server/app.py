# 绘忆 · 立绘转换服务（FastAPI）
# 前端 /convert 页调用：POST /api/convert（multipart 照片）→ 图层 PNG（data URL）+ 配置 JSON。
# v3：输出 front/mid/back 多元素分层（midground/backdrop 无产物时为空串）+ 侘寂纸感风格化。
# 服务器内存态处理：不落盘、不保存照片与产物（隐私承诺，见 development.md §5.4 / README）。
# 运行：./start.sh 或 uvicorn app:app --host 0.0.0.0 --port 8000（后期接入密钥网关做鉴权与限流）
import base64

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from pipeline import run_pipeline

app = FastAPI(title='绘忆 · 立绘转换服务', version='0.3.0')

# 前期本地开发全放行；部署到云服务器后收紧为前端站点来源 + 密钥网关（development.md §5.4）
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_methods=['*'],
    allow_headers=['*'],
)

MAX_PHOTO_BYTES = 25 * 1024 * 1024


@app.post('/api/convert')
def convert(photo: UploadFile = File(...)):
    data = photo.file.read(MAX_PHOTO_BYTES + 1)
    if len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=413, detail='照片太大（>25MB）')
    try:
        result = run_pipeline(data)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    resp = {
        'foreground': _data_url(result['foreground']),
        'background': _data_url(result['background']),
        'base': _data_url(result['base']),
        'shadow': _data_url(result['shadow']),
        'config': result['config'],
    }
    # 多元素分层产物（该带无元素 → 空串，前端按 null 处理）
    resp['midground'] = _data_url(result['midground']) if result.get('midground') else ''
    resp['backdrop'] = _data_url(result['backdrop']) if result.get('backdrop') else ''
    return resp


@app.get('/api/health')
def health():
    return {'ok': True, 'service': 'huiyi-convert'}


def _data_url(png: bytes) -> str:
    return 'data:image/png;base64,' + base64.b64encode(png).decode('ascii')
