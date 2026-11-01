import pytest
from app.pipeline.neural_notes import normalize_bass_notes, drum_events


def test_bass_suppresses_overlapping_harmonic_and_keeps_repeated_attacks():
    notes=[(0, .5, 35, .8, None), (0, .5, 47, .4, None), (.5,1,35,.85,None)]
    result=normalize_bass_notes(notes,strings=5,duration=1)
    assert [e['pitch'] for e in result]==[35,35]
    assert result[0]['end']==pytest.approx(.5)
    assert result[1]['start']==pytest.approx(.5)


def test_low_b_and_string_range():
    notes=[(0,1,23,.8,None),(1,2,28,.8,None),(2,3,80,.9,None)]
    assert [n['pitch'] for n in normalize_bass_notes(notes,strings=5,duration=3)]==[23,28]
    assert [n['pitch'] for n in normalize_bass_notes(notes,strings=4,duration=3)]==[28]


def test_octave_error_uses_reliable_pitch_support():
    support=[dict(start=0,end=1,pitch=35,confidence=.95)]
    result=normalize_bass_notes([(0,1,47,.8,None)],strings=5,duration=1,support=support)
    assert result[0]['pitch']==35
    assert result[0]['confidence']>0


def test_low_confidence_pitch_support_does_not_override_model():
    support=[dict(start=0,end=1,pitch=35,confidence=.2)]
    result=normalize_bass_notes([(0,1,47,.8,None)],strings=5,duration=1,support=support)
    assert result[0]['pitch']==47


def test_drum_model_retains_five_classes_and_simultaneous_hits():
    result=drum_events({35:[.1],38:[.1],47:[.2],42:[.3],49:[.4]},duration=1)
    assert {e['pitch'] for e in result}=={36,38,47,42,49}
    assert sum(e['start']==.1 for e in result)==2
    assert all(e['end']>e['start'] for e in result)


def test_bad_predictions_are_not_serialized():
    result=normalize_bass_notes([(float('nan'),1,35,.9,None),(-1,.2,35,.9,None)],strings=5,duration=1)
    assert len(result)==1
    assert result[0]['start']==0


def test_short_spurious_overlap_does_not_split_held_note():
    result=normalize_bass_notes([(0,1,35,.8,None),(.3,.32,40,.95,None)],strings=5,duration=1)
    assert len(result)==1
    assert result[0]['start']==0
    assert result[0]['end']==1


def test_reliable_sustain_removes_short_same_pitch_tail():
    support=[dict(start=0,end=1,pitch=45,confidence=.95)]
    result=normalize_bass_notes([(0,.9,45,.8,None),(.9,1,45,.35,None)],strings=5,duration=1,support=support)
    assert len(result)==1
    assert result[0]['end']==1


def test_low_b_sustain_can_restore_missing_neural_duration():
    support=[dict(start=0,end=2,pitch=23,confidence=.83)]
    result=normalize_bass_notes([(1.6,1.8,35,.4,None)],strings=5,duration=2,support=support)
    assert len(result)==1
    assert result[0]['pitch']==23
    assert result[0]['start']==0
    assert result[0]['end']==2
