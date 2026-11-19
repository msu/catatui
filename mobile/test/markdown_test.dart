import 'package:catai/config.dart';
import 'package:catai/markdown.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('fixTables does not change a correct table or plain text', () {
    const good = 'Here:\n\n| A | B |\n|---|:-:|\n| 1 | 2 |\n\nEnd.';
    expect(fixTables(good), 'Here:\n\n| A | B |\n| --- | :-: |\n| 1 | 2 |\n\nEnd.');
    expect(fixTables('No table here.\nA | B is only text.'), 'No table here.\nA | B is only text.');
    expect(fixTables('Title | sub\n---'), 'Title | sub\n---');
  });

  test('fixTables gives the divider row the columns of the header', () {
    expect(fixTables('| A | B | C |\n|---|---|\n| 1 | 2 | 3 |'), '| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |');
    expect(fixTables('| A | B |\n|:--|--:|---|---|\n| 1 | 2 |'), '| A | B |\n| :-- | --: |\n| 1 | 2 |');
  });

  test('fixTables removes empty lines between the rows', () {
    expect(fixTables('| A | B |\n\n|---|---|\n\n| 1 | 2 |\n\n| 3 | 4 |\n\nEnd.'), '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n\nEnd.');
  });

  test('fixTables does not change a code fence', () {
    const code = '```\n| A | B | C |\n|---|---|\n```';
    expect(fixTables(code), code);
  });

  test('menuOrder: preferred models, then the others, then the specialist models', () {
    expect(menuOrder(['Goedel-Prover-V2', 'codegemma:7b', 'llama3.1:8b', 'gpt-oss:120b', 'medgemma:4b', 'mistral-small:24b', 'Qwen3.8-27B']), [
      'Qwen3.8-27B',
      'gpt-oss:120b',
      'llama3.1:8b',
      'mistral-small:24b',
      'Goedel-Prover-V2',
      'codegemma:7b',
      'medgemma:4b',
    ]);
    expect(modelName('Qwen3.8-27B'), 'Qwen 3.8');
    expect(modelName('new-model:1b'), 'new-model:1b');
  });
}
