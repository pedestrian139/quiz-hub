import json
import sys

scratch_path = r"C:\Users\123\.gemini\antigravity\brain\8a29c743-f197-4be0-93dd-b64046aa85b6\scratch\raw_comprehensive.json"
with open(scratch_path, encoding='utf-8') as f:
    items = json.load(f)

print(f"Total questions: {len(items)}")
ids = set()
by_chapter = {}
by_type = {}

for idx, q in enumerate(items):
    qid = q.get('id')
    assert qid and isinstance(qid, str), f"Invalid id at {idx}"
    assert qid not in ids, f"Duplicate id {qid} at {idx}"
    ids.add(qid)
    
    qtype = q.get('type')
    assert qtype in ('choice', 'multi', 'tf', 'short', 'analysis'), f"Invalid type in {qid}: {qtype}"
    by_type[qtype] = by_type.get(qtype, 0) + 1
    
    chapter = q.get('chapter')
    assert isinstance(chapter, int) and 1 <= chapter <= 9, f"Invalid chapter in {qid}: {chapter}"
    by_chapter[chapter] = by_chapter.get(chapter, 0) + 1
    
    stem = q.get('stem')
    assert isinstance(stem, str) and len(stem.strip()) > 0, f"Invalid stem in {qid}"
    
    if qtype in ('choice', 'multi'):
        options = q.get('options')
        assert isinstance(options, list) and len(options) >= 2, f"Missing options in {qid}"
        for opt in options:
            assert isinstance(opt, str) and len(opt.strip()) > 0, f"Empty opt in {qid}"
            assert not opt.startswith(('A.', 'B.', 'C.', 'D.', 'A、', 'B、', 'C、', 'D、')), f"Prefix in opt of {qid}: {opt}"
        
        answer = q.get('answer')
        if qtype == 'choice':
            assert isinstance(answer, int) and 0 <= answer < len(options), f"Bad choice answer in {qid}: {answer}"
        else:
            assert isinstance(answer, list) and len(answer) >= 2, f"Bad multi answer in {qid}: {answer}"
            assert sorted(answer) == answer, f"Unsorted multi answer in {qid}: {answer}"
            for ans in answer:
                assert isinstance(ans, int) and 0 <= ans < len(options), f"Bad multi option index in {qid}: {ans}"
    elif qtype == 'tf':
        assert 'options' not in q or q.get('options') is None, f"Options should not be in tf: {qid}"
        assert isinstance(q.get('answer'), bool), f"Bad tf answer in {qid}"
    
    explain = q.get('explain')
    assert isinstance(explain, str) and len(explain.strip()) > 0, f"Empty explain in {qid}"
    
    source = q.get('source')
    assert isinstance(source, dict) and source.get('origin') == 'comprehensive_bank', f"Bad source origin in {qid}"
    assert source.get('file') == '人工智能导论 综合题库最终版.pdf', f"Bad source file in {qid}"
    assert source.get('ref'), f"Missing source ref in {qid}"

print("All validation passed successfully!")
print("By Chapter:", sorted(by_chapter.items()))
print("By Type:", sorted(by_type.items()))
