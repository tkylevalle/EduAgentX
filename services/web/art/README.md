# The school's art

Experience Mode shows the platform as a school building on a model-maker's
table. This folder holds the sources of that picture and the scripts that
build it. The page loads only the packed files in `public/school/`.

## What is here

| Folder | Content |
|---|---|
| `concepts/` | Design targets for the upgrade: three directions (`a-`, `b-`, `c-`), the character sheet, three screen targets (campus, exam hall, report card). Also the three sheets that are used as assets: `textures.png`, `stickers.png`, `backdrop.png`. |
| `blender/` | Python scripts that build every 3D model, light it and render it. No `.blend` file is kept; the scripts are the source. |
| `renders/` | Blender output. Not in git (120 MB); the scripts make it again. |
| `pack.py` | Cuts, keys and compresses the renders and the sheets into `public/school/`, and writes `src/school/art/manifest.json`. |
| `before/`, `after/` | Screenshots and a video of the frontend before and after this work. The after video is 1920 x 1200 at 30 frames a second. |

## How a picture gets to the page

1. **Direction.** Direction C (a dollhouse school, stop-motion miniature) was
   chosen from the three concepts. The screen targets fixed the layout: room
   on top, brass rail, papers on the table.
2. **Models.** `blender/kit.py` and `mats.py` hold the scene, camera, lights
   and materials. `props.py` and `furniture.py` build the objects, `sets.py`
   the nine rooms, `quill.py` and `quill_poses.py` the robot and its 17 poses.
3. **Renders.** Every room is rendered twice from one camera: a back plate
   (walls, floor, far furniture) and a front plate (near furniture). The robot
   is rendered alone as frames. `extras.py` renders the roofs and three props.
4. **Pack.** `pack.py` makes WebP sprite sheets (4 frames wide), room plates,
   800 px room thumbnails, seamless texture tiles and sticker cut-outs. The
   manifest records where each board, clock and lamp is in a room, so the page
   can draw live records exactly on them.
5. **Page.** `src/school/stage/` draws the building: thumbnails for every
   room, full plates for the room in view, the robot between the back and the
   front plate, live overlays, dust and light on top.

```bash
"C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background --python art/blender/rooms.py -- render
```

```bash
"C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background --python art/blender/quill.py -- render
```

```bash
"C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background --python art/blender/extras.py -- roof
```

```bash
python art/pack.py
```

Run the commands from `services/web`. `pack.py` needs Pillow and NumPy.

## Why prerendered and not real-time 3D

The rooms need soft area light, bounce light and a shallow depth of field to
read as a miniature. Cycles gives that; a real-time renderer in the browser
would need baked light maps and a 3D engine in the bundle for a worse picture.
Layered plates keep the depth (two plates and the robot move apart with the
pointer) and cost 6.9 MB in all. The page adds no animation or 3D library:
the camera, the sprite player and the particles are about 300 lines in
`src/school/stage/` and `src/school/motion/`.

## Assets produced

- Robot: 17 poses, 12 or 24 frames each at 512 px, 9 with a graduation-cap
  overlay, and an empty desk (4.4 MB).
- Rooms: 9 rooms, each a back plate, a front plate (2400 x 1350) and a
  thumbnail; a main roof with a clock tower; a wing roof (1.7 MB).
- Interface: 4 seamless textures (walnut, paper, cork, chalkboard), 12 sticker
  cut-outs (paperclip, pin, tack, tape, binder clip, stamp, seal, rosette,
  star, crest, pencil, chalk), a blurred workshop backdrop, 3 foreground props.

## What is real on the stage

Nothing on the stage is invented. The classroom board lists the lessons of the
active course and ticks the ones the run's class delivered. The exam board
shows the paper's real slots. The office and careers boards pin real diploma
scores. The staff board pins the open incidents. The workshop lamps are the
services' health checks. Every clock shows the time of day. The robot's pose
comes from the last event of the run, or from the room's real state (open
safety alerts, service health) when no run is playing.

## Checked

- `npm test`: 54 tests pass, including the campus geometry, the camera tween,
  the room routes and the robot's ambient pose.
- `npx vite build` passes.
- In the browser at 1440 x 900: every view, a passing run (Careful, 92.2%) and
  a failing run (Pushover, 82.2%, a broken safety rule, catch-up class) from
  the campus to the last room; the diploma check; an incident expanded in the
  staff room; the evidence bundle generated; a job posted with one match.
- At 390 x 844: campus, exam hall, graduation hall. No horizontal scroll.
- Reduced motion: the camera cuts, the robot holds one frame, papers do not
  animate.
- Camera moves at 1440 x 900: at most 3 frames longer than 25 ms in a move.
- Operator Mode: no School style reaches an Operator component (class names
  compared by script); the overview page was checked by eye.

## Limits

- The live-model student (Real AI) was not run in this pass.
- The art has one size. On a screen wider than about 2400 px the room in view
  is drawn larger than its plate.
- On a phone the campus view is small; the rail names the rooms there.
- The robot cannot walk between floors. It goes out of sight and appears in
  the new room while the camera travels.
- Acknowledge and resolve in the staff room, and "Certify a candidate" in the
  careers office, were not submitted in this pass. They call the same
  routes as the Operator pages.
- The Docker image of the test stack was not rebuilt; it serves the earlier
  frontend until it is.
