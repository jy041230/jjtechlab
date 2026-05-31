"""
박사논문 시스템 구현 모듈
모듈명: ArUco 기준 마커 보정
박사논문 위치: 제6장 6.4.4절 '기준 마커 기반 절대 치수 보정'
학술적 기여:
    ② 카메라 비전 보조 판단 — 절대 치수 정확도 확보
학술 인용:
    Garrido-Jurado et al. 2014 — ArUco: 사각 마커 기반 자동 검출/포즈 추정
작성일: 2026-05-22

[배경 — 왜 마커 보정인가]
색상 분할 베이스라인은 잎 면적 비율에는 강건하나, 수간 굵기 같은
선형 치수는 (1) 촬영 거리·각도 변화, (2) 절대 크기 기준 부재 때문에
반복 측정 시 값이 크게 요동한다(실측: 같은 나무 0~43mm). ArUco 마커를
줄기에 붙이거나 옆에 두고 함께 촬영하면, 마커의 알려진 실제 크기로부터
픽셀-실측(mm) 변환을 매 촬영마다 산출하여 거리 변화에 무관한 일관된
치수를 얻는다.

[한계 명시 — 학술적 정직성 §3.1]
- 마커가 측정 대상(줄기)과 다른 깊이(카메라로부터 거리)에 있으면 원근
  오차가 생긴다. 마커를 줄기 표면에 최대한 붙여 같은 평면에 두어야 한다.
- 마커가 심하게 기울면 검출 사각형이 왜곡되어 보정 오차가 커진다.
- 본 모듈은 마커의 '검출 픽셀 변 길이'만으로 단순 환산하며, 완전한
  카메라 캘리브레이션(렌즈 왜곡 보정)은 후속 작업으로 분리한다.
"""

from __future__ import annotations
import logging
from dataclasses import dataclass
from typing import Optional

import numpy as np

try:
    import cv2
    _CV2_AVAILABLE = True
except (ImportError, OSError):
    cv2 = None
    _CV2_AVAILABLE = False

logger = logging.getLogger(__name__)

# 기본 마커 사전 및 실제 크기
DEFAULT_DICT = "DICT_4X4_50"     # 4x4, 50종 — 인쇄·검출에 무난
DEFAULT_MARKER_MM = 30.0         # 인쇄 시 한 변 30mm 권장

# 자동 탐색 사전 목록.
# 사장님 마커는 ARUCO_ORIGINAL 사전이며, 여러 사전을 동시에 뒤지면 4X4 등에서
# 가짜 ID(노이즈)가 섞여 오검출·오보정을 유발한다(실측: ID 17/37, 4px).
# 따라서 ARUCO_ORIGINAL 단일 사전만 사용한다. 다른 사전 마커로 바꿀 경우
# 이 목록 또는 detect_aruco(dict_name=...) 인자를 변경한다.
_CANDIDATE_DICTS = ["DICT_ARUCO_ORIGINAL"]

# 오검출 방지: 마커 변이 이보다 작으면(픽셀) 무시.
# 노이즈(4px) 차단 + 너무 작아 부정확한 보정(수십 px 미만) 거부.
# 정확한 보정을 위해 마커는 화면에서 충분히 크게(권장 100px+) 잡혀야 한다.
_MIN_VALID_SIDE_PX = 60.0


@dataclass
class ArucoResult:
    """ArUco 검출 결과.

    Attributes:
        found:           마커 검출 여부.
        marker_id:       검출된 마커 ID (없으면 None).
        side_px:         마커 한 변의 평균 픽셀 길이.
        marker_real_mm:  마커 한 변의 실제 mm.
        pixel_per_mm:    픽셀당 mm (= side_px / marker_real_mm).
        corners:         마커 4 꼭짓점 좌표 (np.ndarray, 없으면 None).
        message:         사람이 읽는 상태 메시지.
    """
    found:          bool
    marker_id:      Optional[int] = None
    side_px:        float = 0.0
    marker_real_mm: float = DEFAULT_MARKER_MM
    pixel_per_mm:   float = 0.0
    corners:        Optional["np.ndarray"] = None
    message:        str = ""


def _get_dictionary(dict_name: str):
    """OpenCV 신/구 API 모두에서 ArUco 사전을 가져온다."""
    a = cv2.aruco
    dict_id = getattr(a, dict_name, getattr(a, DEFAULT_DICT))
    # 신 API
    if hasattr(a, "getPredefinedDictionary"):
        return a.getPredefinedDictionary(dict_id)
    # 구 API
    return a.Dictionary_get(dict_id)


def _make_params():
    """기울어짐·회색 인쇄·조명 변화에 강건한 검출 파라미터.

    기본값은 적응형 임계값 창과 다각형 근사가 빡빡해, 비스듬히 놓이거나
    회색으로 인쇄된 마커를 놓치는 경우가 있다(실측 확인). 임계값 창 범위와
    근사 허용오차를 넓혀 검출률을 높인다.
    """
    a = cv2.aruco
    p = (a.DetectorParameters() if hasattr(a, "DetectorParameters")
         else a.DetectorParameters_create())
    try:
        p.adaptiveThreshWinSizeMin = 3
        p.adaptiveThreshWinSizeMax = 83
        p.adaptiveThreshWinSizeStep = 10
        p.minMarkerPerimeterRate = 0.01      # 작게 잡힌 마커도 허용
        p.maxMarkerPerimeterRate = 4.0
        p.polygonalApproxAccuracyRate = 0.08  # 기울어진 사각형 허용
    except Exception:                          # noqa: BLE001
        pass
    return p


def _detect_markers(gray, dictionary):
    """신 API(ArucoDetector) 우선, 없으면 구 API(detectMarkers)로 검출."""
    a = cv2.aruco
    params = _make_params()
    if hasattr(a, "ArucoDetector"):
        detector = a.ArucoDetector(dictionary, params)
        corners, ids, _ = detector.detectMarkers(gray)
    else:
        corners, ids, _ = a.detectMarkers(gray, dictionary, parameters=params)
    return corners, ids


def _side_length_px(corner: "np.ndarray") -> float:
    """마커 4 꼭짓점으로부터 네 변의 평균 길이(픽셀)를 구한다.

    corner: (4, 2) 좌표 (시계방향). 네 변 길이의 평균을 사용해
    한쪽이 기울어 짧아진 경우의 편향을 완화한다.
    """
    pts = corner.reshape(4, 2).astype(float)
    sides = [
        float(np.linalg.norm(pts[i] - pts[(i + 1) % 4]))
        for i in range(4)
    ]
    return float(np.mean(sides))


def _detect_any_dict(gray, dict_names):
    """여러 사전을 차례로 시도해 첫 (유효) 검출을 반환.

    각 사전 결과에서 최소 크기(_MIN_VALID_SIDE_PX) 이상인 마커만 남긴다.
    노이즈성 초소형 오검출(수 px)과 진짜 마커가 섞여도 진짜만 통과시킨다.
    Returns: (corners, ids, dict_name) — 못 찾으면 (None, None, None).
    """
    for dn in dict_names:
        try:
            dictionary = _get_dictionary(dn)
            corners, ids = _detect_markers(gray, dictionary)
            if ids is None or len(corners) == 0:
                continue
            ids_flat = ids.flatten()
            kept = [(c, int(i)) for c, i in zip(corners, ids_flat)
                    if _side_length_px(c) >= _MIN_VALID_SIDE_PX]
            if kept:
                f_corners = [k[0] for k in kept]
                f_ids = np.array([[k[1]] for k in kept])
                return f_corners, f_ids, dn
        except Exception:                                # noqa: BLE001
            continue
    return None, None, None


def detect_aruco(
    image_rgb: "np.ndarray",
    marker_real_mm: float = DEFAULT_MARKER_MM,
    dict_name: str = "DICT_ARUCO_ORIGINAL",
) -> ArucoResult:
    """RGB 영상에서 ArUco 마커를 검출하고 보정 척도를 계산한다.

    견고화:
      1) 여러 ArUco 사전을 자동 탐색(사용자가 어떤 생성기로 만든 마커든 대응).
      2) 1차 실패 시 영상을 2배 확대해 재시도(저해상도 촬영 시 내부 패턴이
         뭉개져 검출되지 않는 문제 보완). 확대분의 좌표는 다시 1배로 환산하여
         side_px(원본 기준)를 유지한다.

    Args:
        image_rgb:      RGB numpy 영상.
        marker_real_mm: 마커 한 변의 실제 길이(mm).
        dict_name:      우선 시도할 사전(이후 후보 사전들도 자동 탐색).

    Returns:
        ArucoResult. 여러 마커 검출 시 가장 큰(가까운) 마커를 사용한다.
    """
    if not _CV2_AVAILABLE:
        return ArucoResult(found=False, marker_real_mm=marker_real_mm,
                           message="OpenCV(cv2) 미설치 — 마커 검출 불가")
    try:
        img = np.asarray(image_rgb)
        gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY) if img.ndim == 3 else img

        # 우선순위: 지정 사전 → 나머지 후보
        dict_order = [dict_name] + [d for d in _CANDIDATE_DICTS if d != dict_name]

        # 1차: 원본
        corners, ids, used_dict = _detect_any_dict(gray, dict_order)
        scale_back = 1.0

        # 2차: 확대 재시도 (저해상도 대응)
        if ids is None:
            up = cv2.resize(gray, None, fx=2.0, fy=2.0,
                            interpolation=cv2.INTER_CUBIC)
            corners, ids, used_dict = _detect_any_dict(up, dict_order)
            scale_back = 0.5    # 확대본 좌표 → 원본 좌표 환산

        if ids is None or corners is None or len(corners) == 0:
            return ArucoResult(found=False, marker_real_mm=marker_real_mm,
                               message="마커를 찾지 못했습니다. 마커 전체가 가리지 않게 다시 촬영하세요.")

        best_i = max(range(len(corners)),
                     key=lambda i: _side_length_px(corners[i]))
        side_px = _side_length_px(corners[best_i]) * scale_back
        marker_id = int(ids.flatten()[best_i])

        if side_px <= 0:
            return ArucoResult(found=False, marker_real_mm=marker_real_mm,
                               message="마커 크기 측정 실패")

        ppm = side_px / marker_real_mm
        logger.info("[ArUco] dict=%s id=%d side=%.1fpx %.2fmm → %.3f px/mm",
                    used_dict, marker_id, side_px, marker_real_mm, ppm)
        return ArucoResult(
            found=True, marker_id=marker_id, side_px=side_px,
            marker_real_mm=marker_real_mm, pixel_per_mm=ppm,
            corners=(corners[best_i] * scale_back),
            message=f"마커 검출됨 (ID {marker_id}, {used_dict})",
        )
    except Exception as exc:                            # noqa: BLE001
        logger.error("[ArUco] 검출 오류: %s", exc)
        return ArucoResult(found=False, marker_real_mm=marker_real_mm,
                           message=f"마커 검출 오류: {exc}")


def generate_marker_png(
    out_path: str,
    marker_id: int = 0,
    dict_name: str = DEFAULT_DICT,
    pixels: int = 600,
    border_px: int = 60,
) -> str:
    """인쇄용 ArUco 마커 PNG를 생성한다 (흰 여백 포함).

    Args:
        out_path:   저장 경로 (.png).
        marker_id:  마커 ID (검출 시 이 ID로 식별).
        dict_name:  ArUco 사전 이름.
        pixels:     마커 본체 한 변 픽셀.
        border_px:  흰색 여백(quiet zone) 픽셀. 검출 안정성에 필요.

    Returns:
        저장된 파일 경로.
    """
    if not _CV2_AVAILABLE:
        raise RuntimeError("OpenCV(cv2) 미설치 — 마커 생성 불가")
    a = cv2.aruco
    dictionary = _get_dictionary(dict_name)
    if hasattr(a, "generateImageMarker"):
        marker = a.generateImageMarker(dictionary, marker_id, pixels)
    else:
        marker = a.drawMarker(dictionary, marker_id, pixels)
    # 흰 여백 추가 (검출 안정성)
    canvas = np.full(
        (pixels + 2 * border_px, pixels + 2 * border_px), 255, dtype=np.uint8
    )
    canvas[border_px:border_px + pixels, border_px:border_px + pixels] = marker
    cv2.imwrite(out_path, canvas)
    logger.info("[ArUco] 마커 PNG 생성: %s (id=%d)", out_path, marker_id)
    return out_path
