# Makes the site's Seeker video (web/public/site/seeker-in.mp4) from Video F.
#
# Video F (Flow, Veo 3.1 Fast) is a take-off: the phone glides out of the frame to the left. Played in reverse it
# arrives from the left. This script shifts every frame so the phone stays on the same spot of the frame (73.52%
# across, 50.07% down, its place in the last frame); the page then moves and turns the video itself (web/app/
# globals.css, .seeker-back), so the animation needs no frame-by-frame sync with the video.
#
# It reads rgb24 frames (1280x720) on stdin, finds the phone's bounding box in each (black background, threshold
# 40), smooths the centres over 7 frames and writes the shifted frames on stdout. Frames 48 to 170 of the reversed
# video are used: from frame 48 the whole phone is inside the frame; it settles at frame 161.
#
#   ffmpeg -i kaynak/seeker/seeker-f.mp4 -vf "reverse,trim=start_frame=48:end_frame=171,setpts=PTS-STARTPTS" \
#     -f rawvideo -pix_fmt rgb24 - \
#   | python3 kaynak/seeker/stabilize.py \
#   | ffmpeg -f rawvideo -pix_fmt rgb24 -s 1280x720 -r 24 -i - -an -c:v libx264 -crf 22 -preset slow \
#     -pix_fmt yuv420p -movflags +faststart web/public/site/seeker-in.mp4
#   ffmpeg -sseof -0.1 -i web/public/site/seeker-in.mp4 -frames:v 1 -q:v 82 web/public/site/seeker-poster.webp
import sys

import numpy as np

W, H = 1280, 720
frames = np.frombuffer(sys.stdin.buffer.read(), np.uint8).reshape(-1, H, W, 3)
n = len(frames)
cx = np.zeros(n)
cy = np.zeros(n)
for i, f in enumerate(frames):
    lit = f.max(axis=2) > 40
    rows = np.where(lit.sum(axis=1) > 6)[0]
    cols = np.where(lit.sum(axis=0) > 6)[0]
    cx[i] = (cols.min() + cols.max()) / 2
    cy[i] = (rows.min() + rows.max()) / 2

k = 7
sx = np.convolve(np.pad(cx, k // 2, mode="edge"), np.ones(k) / k, mode="valid")
sy = np.convolve(np.pad(cy, k // 2, mode="edge"), np.ones(k) / k, mode="valid")
fx, fy = 0.7352 * W, 0.5007 * H

out = np.zeros_like(frames[0])
for i, f in enumerate(frames):
    dx = int(round(fx - sx[i]))
    dy = int(round(fy - sy[i]))
    out[:] = 0
    y0, y1 = max(0, -dy), min(H, H - dy)
    x0, x1 = max(0, -dx), min(W, W - dx)
    out[y0 + dy : y1 + dy, x0 + dx : x1 + dx] = f[y0:y1, x0:x1]
    sys.stdout.buffer.write(out.tobytes())
print(f"frames {n}; first shift {fx - sx[0]:.1f}, {fy - sy[0]:.1f}; last {fx - sx[-1]:.1f}, {fy - sy[-1]:.1f}", file=sys.stderr)
