"""Run upstream BrowserGym and selected original Fara/Browser Use functions.

AST extraction executes original function bodies without importing paid-model stacks.
It is deliberately reported separately from full-runtime execution.
"""
import ast
import datetime
import importlib.metadata
import json
from pathlib import Path
import sys
import typing

ROOT = Path(__file__).resolve().parent
VENDOR = ROOT / 'vendor'
sys.path[:0] = [str(VENDOR / 'BrowserGym/browsergym/core/src'), str(ROOT.parent / '.cache/routes-python')]

def extract(project, path, names):
    filename = VENDOR / project / path
    tree = ast.parse(filename.read_text(encoding='utf8'))
    functions = [node for node in ast.walk(tree) if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in names]
    assert {n.name for n in functions} == set(names)
    # Decorators have no effect on function body semantics; retain staticmethod too.
    ns = dict(vars(typing))
    exec(compile(ast.Module(body=functions, type_ignores=[]), str(filename), 'exec'), ns)
    return ns

output = {'date': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'python': sys.version.split()[0], 'packages': {p: importlib.metadata.version(p) for p in ['playwright', 'numpy']}}
fara = extract('fara', 'webeval/src/webeval/rubric_agent/mm_rubric_agent.py', ['_validate_rescore', '_compute_final_scores'])
valid = {'applicable_evidence': 'visible record', 'post_image_justification': 'matched final state', 'post_image_earned_points': 1}
fara['_validate_rescore'](valid, 1)
rejected = []
for value in [2, float('nan'), '1']:
    try:
        fara['_validate_rescore']({**valid, 'post_image_earned_points': value}, 1)
        rejected.append(False)
    except ValueError:
        rejected.append(True)
assert all(rejected)
fara['_validate_rescore']({**valid, 'post_image_earned_points': True}, 1)
scores = fara['_compute_final_scores']({'items': [{'max_points': 1, 'post_image_earned_points': 1}, {'condition': 'optional', 'is_condition_met': False, 'max_points': 5, 'post_image_earned_points': 5}]})
assert scores == {'total_max_points': 1.0, 'total_earned_points': 1.0}
output['fara_partial_functions'] = {'invalid_scores_rejected': rejected, 'boolean_score_accepted': True, 'conditional_score': scores, 'full_verifier_executed': False}

security = extract('browser-use', 'browser_use/browser/watchdogs/security_watchdog.py', ['_is_ip_address'])['_is_ip_address']
ip_results = {host: security(None, host) for host in ['127.0.0.1', '2130706433', '0x7f000001', '127.1', 'example.com']}
assert all(ip_results[h] for h in ['127.0.0.1', '2130706433', '0x7f000001', '127.1']) and not ip_results['example.com']
output['browser_use_partial_function'] = ip_results

from browsergym.core.env import BrowserEnv
from browsergym.core.task import AbstractBrowserTask

class LocalTask(AbstractBrowserTask):
    @classmethod
    def get_task_id(cls):
        return 'research-local-registered-once'

    def setup(self, page):
        self.validations = 0
        page.goto('data:text/html,<button onclick="window.records=(window.records||0)+1">Register</button>')
        return 'Create exactly one registration.', {}

    def validate(self, page, chat_messages):
        self.validations += 1
        count = page.evaluate('window.records||0')
        return float(count == 1), count == 1, '', {'count': count, 'validations': self.validations}

env = BrowserEnv(LocalTask, action_mapping=None, slow_mo=0, pre_observation_delay=0, pw_chromium_kwargs={'channel': 'chrome'})
try:
    obs, info = env.reset(seed=42)
    output['browsergym'] = {'browser': env.browser.version, 'initial_observation_keys': sorted(obs)}
    _, reward, done, _, _ = env.step("send_message_to_user('Task complete')")
    assert reward == 0 and done is False
    output['browsergym']['self_claim'] = {'reward': reward, 'done': done}
    _, reward, done, _, info = env.step("page.get_by_role('button', name='Register').click()")
    assert reward == 1 and done is True
    output['browsergym']['actual_action'] = {'reward': reward, 'done': done, 'records': env.page.evaluate('window.records||0'), 'validations': env.task.validations}
    output['webmcp_feature_detection'] = env.page.evaluate("({documentModelContext: typeof document.modelContext, navigatorModelContext: typeof navigator.modelContext, navigatorModelContextTesting: typeof navigator.modelContextTesting, secureContext: isSecureContext})")
finally:
    env.close()

(ROOT / 'runs').mkdir(exist_ok=True)
(ROOT / 'runs/routes-probe.json').write_text(json.dumps(output, indent=2), encoding='utf8')
print(json.dumps(output, indent=2))
