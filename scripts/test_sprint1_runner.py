import importlib.util
import subprocess
import unittest
from pathlib import Path
from unittest.mock import Mock


spec = importlib.util.spec_from_file_location('sprint1_runner', Path(__file__).with_name('run-sprint1.py'))
runner_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner_module)


class ComponentSetupTests(unittest.TestCase):
    def setUp(self):
        self.runner = runner_module.EvidenceRun.__new__(runner_module.EvidenceRun)
        self.runner.checks = {}
        self.runner.report = {}
        self.runner.command = Mock(side_effect=self.command_result)

    @staticmethod
    def command_result(command, *args, **kwargs):
        output = '{}'
        if command[:2] == ['node', '--test']:
            output = '# tests 1\n# fail 0\n# skipped 0\n# cancelled 0\n# todo 0\n'
        return subprocess.CompletedProcess(command, 0, stdout=output)

    def test_every_component_is_installed_before_any_cross_service_test(self):
        self.runner.run_component_tests()
        commands = [call.args[0] for call in self.runner.command.call_args_list]
        installs = [index for index, command in enumerate(commands) if command[:2] == ['npm', 'ci']]
        tests = [index for index, command in enumerate(commands) if command[:2] == ['node', '--test']]
        self.assertEqual(len(installs), len(runner_module.COMPONENTS))
        self.assertEqual(len(tests), len(runner_module.COMPONENTS))
        self.assertLess(max(installs), min(tests))
        self.assertEqual({commands[index][-1] for index in installs},
                         {str(directory) for directory in runner_module.COMPONENTS.values()})
        self.assertTrue(self.runner.checks['component_tests'])

    def test_install_failure_prevents_tests_and_a_passing_component_check(self):
        def fail_install(command, *args, **kwargs):
            if command[:2] == ['npm', 'ci'] and command[-1] == str(runner_module.COMPONENTS['examination-engine']):
                raise RuntimeError('dependency installation failed')
            return self.command_result(command, *args, **kwargs)

        self.runner.command.side_effect = fail_install
        with self.assertRaisesRegex(RuntimeError, 'dependency installation failed'):
            self.runner.run_component_tests()
        self.assertFalse(any(call.args[0][:2] == ['node', '--test']
                             for call in self.runner.command.call_args_list))
        self.assertNotIn('component_tests', self.runner.checks)


if __name__ == '__main__':
    unittest.main()
