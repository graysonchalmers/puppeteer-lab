"""
@license
SPDX-License-Identifier: Apache-2.0

Blender importer for puppeteer-lab recording v3 files. Accepts either schema
"puppeteer-lab/recording" (the full file) or "puppeteer-lab/kinematics" (the
lighter export-only file for animation tools, no raw landmarks or audio) --
see components/shared/recordingSchema.ts and
docs/tdd/TDD-002-recording-schema-and-export.md.

Run it from Blender's Text Editor: open this file in a Text Editor area, set
DEFAULT_JSON_PATH below (or the PUPPETEER_LAB_TAKE environment variable) to
the recording's path, then click Run Script.

Or run it headless from the command line:

    blender --python tools/blender_import_recording.py -- path/to/take.json

The JSON-parsing and math helpers below have no bpy dependency, so they can
be imported and exercised outside Blender (a plain `python -c "import
tools.blender_import_recording as m; ..."` works). Everything that touches
the scene lives in the second half of the file, behind `if bpy is not None`.
"""

import base64
import json
import os
import sys

# --- Plain functions: no bpy dependency, statically checkable outside Blender ---

SUPPORTED_SCHEMAS = ("puppeteer-lab/recording", "puppeteer-lab/kinematics")
SUPPORTED_VERSION = 3
HAND_LANDMARK_COUNT = 21
HAND_EMPTY_DISPLAY_SIZE = 0.03
ROOT_EMPTY_DISPLAY_SIZE = 0.1
FACE_LANDMARK_EMPTY_DISPLAY_SIZE = 0.01


def load_envelope(path):
    """Read and validate a v3 recording envelope. Raises ValueError on a
    schema/version mismatch (design step 1)."""
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    schema = data.get("schema")
    version = data.get("version")
    if schema not in SUPPORTED_SCHEMAS:
        raise ValueError("Unsupported schema %r, expected one of %r" % (schema, SUPPORTED_SCHEMAS))
    if version != SUPPORTED_VERSION:
        raise ValueError("Unsupported version %r, expected %r" % (version, SUPPORTED_VERSION))
    return data


def compute_fps(capture):
    """scene.render.fps = round(capture.fps) (design step 2). capture.fps can
    be a non-round float (a real device's measured frame rate); this is the
    one place that gets rounded to an integer for Blender's render settings."""
    return round(capture.get("fps", 0))


def compute_frame_end(duration_ms, fps):
    """scene.frame_end = round(durationMs / 1000 * fps) (design step 2)."""
    return round(duration_ms / 1000.0 * fps)


def compute_frame_number(t_ms, fps):
    """A frame's Blender frame number: round(t / 1000 * fps) (design step 4).
    Uses the same rounded fps as compute_frame_end, not the raw capture.fps,
    so frame_end and every keyframe are computed from one consistent number."""
    return round(t_ms / 1000.0 * fps)


def remap_axis(x, y, z):
    """Y-up (app) -> Z-up (Blender): (x, y, z) -> (x, -z, y) (design step 4)."""
    return (x, -z, y)


def side_label(side):
    """'right' -> 'R', 'left' -> 'L', matching the Hand.R / Hand.L naming in
    design step 3."""
    return "R" if side == "right" else "L"


def sides_present(frames):
    """Every hand side that appears in at least one frame, in a stable
    (right, then left) order, so object creation order is deterministic."""
    seen = set()
    for frame in frames:
        for hand in frame.get("hands") or []:
            seen.add(hand.get("side"))
    return [s for s in ("right", "left") if s in seen]


def blendshape_names(frames):
    """Every blendshape key that appears in at least one frame's face data,
    sorted for stable ordering.

    Deliberately does NOT gate on envelope.channels including "face": the
    real buildEnvelope() (Task 1, recordingSchema.ts) calls mapFrameFace()
    unconditionally for every frame regardless of the recording's
    TrackingType, so a "hands"-channel recording can still carry real face
    data per frame (confirmed against a literal buildEnvelope() output, not
    assumed from the TDD's prose). Scanning frames directly for face data is
    the shape that actually matches what the exporter produces."""
    names = set()
    for frame in frames:
        face = frame.get("face")
        if face and face.get("blendshapes"):
            names.update(face["blendshapes"].keys())
    return sorted(names)


def face_landmark_count(frames):
    """Length of the first non-null face.landmarks array found, or 0 if none
    of the frames carry face landmarks. Used only when
    CREATE_FACE_LANDMARK_EMPTIES is turned on."""
    for frame in frames:
        face = frame.get("face")
        if face and face.get("landmarks"):
            return len(face["landmarks"])
    return 0


# --- bpy-dependent functions ---

try:
    import bpy
except ImportError:  # allows import and the plain functions above to run outside Blender
    bpy = None


# 478 face landmark empties is heavy for routine imports; off by default per
# design step 5. Flip to True (or add a UI toggle later) to get full raw face
# mesh landmarks as keyframed empties in addition to the blendshape values.
CREATE_FACE_LANDMARK_EMPTIES = False

RECORDING_COLLECTION_NAME = "PuppeteerLabRecording"
AXIS_TRIAD_NAME = "PuppeteerLab.AxisTriad"
FACE_EMPTY_NAME = "Face"
FACE_LANDMARKS_ROOT_NAME = "Face.Landmarks"


def _get_or_create_collection(name):
    coll = bpy.data.collections.get(name)
    if coll is None:
        coll = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(coll)
    return coll


def _get_or_create_empty(name, collection, display_type, display_size, parent=None):
    obj = bpy.data.objects.get(name)
    if obj is None:
        obj = bpy.data.objects.new(name, None)
        obj.empty_display_type = display_type
        obj.empty_display_size = display_size
        if parent is not None:
            obj.parent = parent
        collection.objects.link(obj)
    return obj


def _create_hand_empties(side, collection):
    """Empty Hand.R / Hand.L with 21 child Empties Hand.R.00..Hand.R.20,
    small spheres for visibility (design step 3)."""
    label = side_label(side)
    root_name = "Hand.%s" % label
    root = _get_or_create_empty(root_name, collection, "PLAIN_AXES", ROOT_EMPTY_DISPLAY_SIZE)

    children = []
    for i in range(HAND_LANDMARK_COUNT):
        child_name = "%s.%02d" % (root_name, i)
        child = _get_or_create_empty(child_name, collection, "SPHERE", HAND_EMPTY_DISPLAY_SIZE, parent=root)
        children.append(child)
    return root, children


def _keyframe_hand(children, frame_number, remapped_world_points):
    """remapped_world_points: 21 entries, each an (x, y, z) tuple already run
    through remap_axis(), or None. Nulls are skipped, not treated as (0,0,0)
    (a partial hand's world[] is null everywhere except its one tracked
    landmark, per Task 1)."""
    for i, point in enumerate(remapped_world_points):
        if point is None:
            continue
        child = children[i]
        child.location = point
        child.keyframe_insert(data_path="location", frame=frame_number)


def _create_face_empty(collection):
    return _get_or_create_empty(FACE_EMPTY_NAME, collection, "PLAIN_AXES", ROOT_EMPTY_DISPLAY_SIZE)


def _keyframe_face_blendshapes(face_obj, frame_number, blendshapes, names):
    """A custom property per blendshape, keyframed (design step 5)."""
    for name in names:
        value = blendshapes.get(name)
        if value is None:
            continue
        face_obj[name] = float(value)
        face_obj.keyframe_insert(data_path='["%s"]' % name, frame=frame_number)


def _create_face_landmark_empties(collection, count):
    root = _get_or_create_empty(FACE_LANDMARKS_ROOT_NAME, collection, "PLAIN_AXES", ROOT_EMPTY_DISPLAY_SIZE)
    children = []
    for i in range(count):
        child_name = "%s.%03d" % (FACE_LANDMARKS_ROOT_NAME, i)
        child = _get_or_create_empty(child_name, collection, "SPHERE", FACE_LANDMARK_EMPTY_DISPLAY_SIZE, parent=root)
        children.append(child)
    return children


def _keyframe_face_landmarks(children, frame_number, remapped_points):
    for i, point in enumerate(remapped_points):
        if point is None or i >= len(children):
            continue
        child = children[i]
        child.location = point
        child.keyframe_insert(data_path="location", frame=frame_number)


def _create_axis_triad():
    """A single Empty (ARROWS display) at the origin, so the viewport shows
    Blender's own red/green/blue X/Y/Z arrows (design step 7, the TDD's
    handedness risk note). See docs/blender-importer.md for which arrow lines
    up with "toward the camera" in the app's own coordinate space."""
    obj = bpy.data.objects.get(AXIS_TRIAD_NAME)
    if obj is None:
        obj = bpy.data.objects.new(AXIS_TRIAD_NAME, None)
        obj.empty_display_type = "ARROWS"
        obj.empty_display_size = 1.0
        bpy.context.scene.collection.objects.link(obj)
    return obj


def _import_audio(envelope, json_path):
    """If audio is present: write <name>.webm next to the JSON, add as a
    Sound strip in the Sequencer at frame 1 (design step 6)."""
    audio = envelope.get("audio")
    if not audio:
        return None
    payload = audio.get("base64", "")
    base_name = os.path.splitext(os.path.basename(json_path))[0]
    out_path = os.path.join(os.path.dirname(os.path.abspath(json_path)), "%s.webm" % base_name)
    with open(out_path, "wb") as f:
        f.write(base64.b64decode(payload))

    scene = bpy.context.scene
    if scene.sequence_editor is None:
        scene.sequence_editor_create()
    # SequenceEditor.sequences was renamed to .strips in Blender 4.4+
    # (host-verified: 5.1.1 only has .strips / .strips_all, no .sequences).
    # Fall back to .sequences for older Blender versions.
    strips = getattr(scene.sequence_editor, "strips", None)
    if strips is None:
        strips = scene.sequence_editor.sequences
    return strips.new_sound(
        name="PuppeteerLabAudio", filepath=out_path, channel=1, frame_start=1
    )


def import_recording(json_path):
    """Main entry point: builds Empties, keyframes, the axis triad, and
    (if present) the audio strip from a v3 recording JSON at json_path."""
    envelope = load_envelope(json_path)
    capture = envelope["capture"]
    frames = envelope["frames"]

    fps = compute_fps(capture)
    scene = bpy.context.scene
    scene.render.fps = fps
    # frame_start = 0, not Blender's usual default of 1: t=0 (the first
    # frame's timestamp) maps to Blender frame 0 via compute_frame_number,
    # so starting playback at 1 would silently clip the take's first
    # keyframe out of the playback range.
    scene.frame_start = 0
    scene.frame_end = max(1, compute_frame_end(capture["durationMs"], fps))

    collection = _get_or_create_collection(RECORDING_COLLECTION_NAME)

    hand_children = {}
    for side in sides_present(frames):
        _root, children = _create_hand_empties(side, collection)
        hand_children[side] = children

    names = blendshape_names(frames)
    face_obj = _create_face_empty(collection) if names else None

    landmark_children = []
    if CREATE_FACE_LANDMARK_EMPTIES:
        count = face_landmark_count(frames)
        if count:
            landmark_children = _create_face_landmark_empties(collection, count)

    for frame in frames:
        frame_number = compute_frame_number(frame["t"], fps)

        for hand in frame.get("hands") or []:
            children = hand_children.get(hand.get("side"))
            if children is None:
                continue
            world = hand.get("world") or []
            remapped = [remap_axis(*p) if p is not None else None for p in world]
            _keyframe_hand(children, frame_number, remapped)

        face = frame.get("face")
        if face:
            if face_obj is not None and face.get("blendshapes"):
                _keyframe_face_blendshapes(face_obj, frame_number, face["blendshapes"], names)
            if landmark_children and face.get("landmarks"):
                remapped = [remap_axis(*p) for p in face["landmarks"]]
                _keyframe_face_landmarks(landmark_children, frame_number, remapped)

    _create_axis_triad()
    _import_audio(envelope, json_path)

    return {
        "fps": fps,
        "frame_start": scene.frame_start,
        "frame_end": scene.frame_end,
        "sides": sorted(hand_children.keys()),
        "has_face": face_obj is not None,
    }


DEFAULT_JSON_PATH = None  # set this for Text Editor runs, or use the PUPPETEER_LAB_TAKE env var


def _resolve_json_path():
    if "--" in sys.argv:
        args = sys.argv[sys.argv.index("--") + 1:]
        if args:
            return args[0]
    env_path = os.environ.get("PUPPETEER_LAB_TAKE")
    if env_path:
        return env_path
    if DEFAULT_JSON_PATH:
        return DEFAULT_JSON_PATH
    raise SystemExit(
        "No recording JSON path given. Pass it after '--' when running headless "
        "(blender --python tools/blender_import_recording.py -- take.json), set the "
        "PUPPETEER_LAB_TAKE environment variable, or set DEFAULT_JSON_PATH in this file "
        "for Text Editor runs."
    )


if __name__ == "__main__" and bpy is not None:
    _json_path = _resolve_json_path()
    _result = import_recording(_json_path)
    print("puppeteer-lab importer: %s" % _result)
