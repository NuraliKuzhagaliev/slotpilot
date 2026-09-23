"""Optional independent cross-check. Requires Python jsonschema; not part of app runtime."""
import json
from pathlib import Path
from jsonschema import Draft202012Validator, FormatChecker
ROOT = Path(__file__).resolve().parents[2] / 'docs' / 'stage1a'
def main():
    schemas = json.loads((ROOT / 'tool-input-schemas.json').read_text())
    models = json.loads((ROOT / 'domain-schemas.json').read_text())
    corpus = json.loads((ROOT / 'contract-corpus.json').read_text())
    for schema in [*schemas.values(), *models.values()]:
        Draft202012Validator.check_schema(schema)
    for index, case in enumerate(corpus):
        validator = Draft202012Validator(schemas[case['name']], format_checker=FormatChecker())
        result = validator.is_valid(case['value'])
        assert result == case['accepted'], f'Runtime/schema disagreement in case {index}: {case["name"]}'
    print(f'{len(corpus)} runtime-vs-JSON-Schema cases agree; {len(schemas) + len(models)} schemas are valid.')
if __name__ == '__main__':
    main()
