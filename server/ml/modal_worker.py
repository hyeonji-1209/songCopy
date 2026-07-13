# songCopy AI 채보 GPU 워커 (Modal 서버리스)
#
# 배포:  server/ml/.venv/bin/modal deploy server/ml/modal_worker.py
# 인증 시크릿(1회): modal secret create songcopy-auth SONGCOPY_TOKEN=<랜덤값>
#
# 배포 후 나오는 두 엔드포인트 URL을 서버 환경변수로:
#   MODAL_SUBMIT_URL=https://<workspace>--songcopy-transcribe-submit.modal.run
#   MODAL_RESULT_URL=https://<workspace>--songcopy-transcribe-result.modal.run
#   MODAL_TOKEN=<위 랜덤값>
#
# 모델 가중치는 'songcopy-models' 볼륨에 첫 실행 때 받아서 영구 보관 (첫 곡만 느림).
import base64
import os
import subprocess
import sys
import tempfile

import modal

app = modal.App("songcopy-transcribe")

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

image = (
    modal.Image.debian_slim(python_version="3.12")
    # wget: panns 체크포인트 / git-lfs: YourMT3 체크포인트(HF LFS) 다운로드용
    .apt_install("ffmpeg", "git", "git-lfs", "libsndfile1", "wget")
    # 레거시 sdist 빌드 + pkg_resources(YourMT3 등) 호환: setuptools를 먼저 제공
    .pip_install("setuptools<81", "wheel")
    # numpy를 로컬 검증 버전으로 선고정 — 구형 numpy sdist가 py3.12에서 빌드 실패하는 것 방지
    .pip_install("numpy==1.26.4")
    # 로컬(맥 py3.12)에서 검증된 조합을 설치 "순서"까지 재현.
    # audio-separator(numpy>=2 선언)와 채보 패키지들(numpy<2 필요)은 한 번에 설치하면
    # ResolutionImpossible — 레이어를 나누면 pip이 레이어 간 재검증을 하지 않아 로컬과 동일해진다.
    .pip_install("audio-separator[gpu]==0.44.3")
    .pip_install(
        "mt3-infer==0.1.3",
        "transkun==2.0.1",
        "faster-whisper==1.2.1",
        "panns-inference==0.1.1",
        "transformers==4.45.1",
        "pytorch_lightning==2.6.5",
        "pretty_midi",
        "requests",
        "numpy==1.26.4",
        # basic-pitch 런타임 의존성 (TF 제외 — ONNX 경로만 사용)
        "mir_eval",
        "resampy",
        "scikit-learn",
        "onnxruntime",
        # 모듈 상단의 fastapi import가 GPU 컨테이너에서도 로드됨
        "fastapi",
    )
    # basic-pitch는 리눅스에서 py3.12 미지원 TF를 강제 요구 → 의존성 없이 설치 (ONNX로 구동)
    .pip_install("basic-pitch==0.3.0", extra_options="--no-deps")
    # faster-whisper(ctranslate2) GPU 실행용 CUDA 라이브러리
    .pip_install("nvidia-cublas-cu12", "nvidia-cudnn-cu12>=9")
    .env(
        {
            "LD_LIBRARY_PATH": "/usr/local/lib/python3.12/site-packages/nvidia/cublas/lib:/usr/local/lib/python3.12/site-packages/nvidia/cudnn/lib"
        }
    )
    .add_local_file(os.path.join(SCRIPT_DIR, "..", "scripts", "transcribe_v2.py"), "/app/transcribe_v2.py")
)

web_image = modal.Image.debian_slim(python_version="3.12").pip_install("fastapi[standard]")

vol = modal.Volume.from_name("songcopy-models", create_if_missing=True)
auth_secret = modal.Secret.from_name("songcopy-auth")


@app.function(
    image=image,
    gpu="T4",
    volumes={"/vol": vol},
    timeout=1800,
    memory=12288,
)
def transcribe(audio_bytes: bytes, sensitivity: str = "standard") -> dict:
    """오디오 바이트 → 채보 JSON (transcribe_v2.py를 GPU 설정으로 실행)"""
    import json

    os.makedirs("/vol/home", exist_ok=True)
    os.makedirs("/vol/sep-models", exist_ok=True)
    env = {
        **os.environ,
        "SONGCOPY_DEVICE": "cuda",
        "SONGCOPY_STEM_WORKERS": "1",  # GPU 단일 컨텍스트 재사용
        "SONGCOPY_MODEL_DIR": "/vol/sep-models",
        "HOME": "/vol/home",  # panns(~/panns_data)·기타 캐시를 볼륨에
        "HF_HOME": "/vol/hf",
        "XDG_CACHE_HOME": "/vol/cache",
    }
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        f.write(audio_bytes)
        wav = f.name
    try:
        # cwd=/vol → mt3-infer 체크포인트(.mt3_checkpoints)가 볼륨에 저장됨
        proc = subprocess.run(
            [sys.executable, "/app/transcribe_v2.py", wav, sensitivity],
            capture_output=True,
            text=True,
            timeout=1700,
            env=env,
            cwd="/vol",
        )
        # 진행 로그는 Modal 로그에서 확인 가능
        print(proc.stderr[-2000:], file=sys.stderr)
        if proc.returncode != 0:
            raise RuntimeError(f"transcribe_v2 exit {proc.returncode}: {proc.stderr[-500:]}")
        result = json.loads(proc.stdout)
    finally:
        os.unlink(wav)
        vol.commit()
    return result


from fastapi import Header, HTTPException  # 배포 클라이언트에도 fastapi 필요 (pip install fastapi)


def _check_auth(authorization: str | None):
    expected = os.environ.get("SONGCOPY_TOKEN", "")
    if not expected or authorization != f"Bearer {expected}":
        raise HTTPException(status_code=403, detail="invalid token")


@app.function(image=web_image, secrets=[auth_secret])
@modal.fastapi_endpoint(method="POST")
def submit(body: dict, authorization: str = Header(default=None)):
    """{b64, sensitivity} → {call_id} (비동기 제출)"""
    _check_auth(authorization)
    audio = base64.b64decode(body["b64"])
    sensitivity = body.get("sensitivity", "standard")
    call = transcribe.spawn(audio, sensitivity)
    return {"call_id": call.object_id}


@app.function(image=web_image, secrets=[auth_secret])
@modal.fastapi_endpoint(method="GET")
def result(call_id: str, authorization: str = Header(default=None)):
    """call_id 폴링 → processing | done(result) | failed(error)"""
    _check_auth(authorization)
    fc = modal.FunctionCall.from_id(call_id)
    try:
        r = fc.get(timeout=0)
        return {"status": "done", "result": r}
    except TimeoutError:
        return {"status": "processing"}
    except Exception as e:  # 원격 실행 실패
        return {"status": "failed", "error": str(e)[:500]}
