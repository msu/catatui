// CatChat endpoints and defaults. This is a copy of src/catatui/config.ts. Change the two files together.

const catchatApi = 'https://catchat-api.msu.montana.edu';
const catchatAccess = 'https://catchat-access.msu.montana.edu';

// The key name for SSO sign-in. CatChat names the key <username>_catai-mobile.
const clientName = 'catai-mobile';

// The redirect address for App Connect. No server listens there: the web view stops at this address.
const redirectUri = 'http://127.0.0.1:53682/callback';

// A key is valid for 180 days (the catchat-access maximum).
const keyLifetime = Duration(days: 180);
// The chat screen shows a warning when the key expires in this time or less.
const expiryWarning = Duration(days: 14);

// Demo mode: the demo with mock data. A build setting: --dart-define=CATAI_DEMO=true. See src/md/features/mobile.md.
const demoBuild = bool.fromEnvironment('CATAI_DEMO');

const defaultModel = 'Qwen3.8-27B';

// The first match in this list becomes the model, if the student did not select one.
final preferredModels = [RegExp(r'^qwen3\.\d+-27b$', caseSensitive: false), RegExp(r'^gpt-oss:120b$'), RegExp(r'^gemma4-31b', caseSensitive: false)];

// Notes shown under the model id in the model menu. Keys are CatChat model ids.
const modelNotes = <String, String>{
  'Qwen3.8-27B': 'Alibaba. General and coding model, with thinking. Recommended.',
  'gpt-oss:120b': 'OpenAI open-weight model, with thinking. Good for coding. Fastest.',
  'gemma4-31B-it': 'Google. General model, long context. Good for coding.',
  'muse-glimmer:30b': 'Unknown Model. Very slow.',
  'nimble:9b': 'Unknown Model.',
  'mistral-small:24b': 'Mistral. General chat model.',
  'llama3.1:8b': 'Meta. Small general model.',
  'codegemma:7b': 'Google. Code completion model.',
  'medgemma:4b': 'Google. Medical model for text and images. Not for coding.',
  'Goedel-Prover-V2': 'Theorem prover (Lean). Not for general use.',
};

// Names for students in the model menu. Keys are CatChat model ids. A model with no name shows its id.
const modelNames = <String, String>{
  'Qwen3.8-27B': 'Qwen 3.8',
  'gpt-oss:120b': 'GPT-OSS 120B',
  'gemma4-31B-it': 'Gemma 4',
  'muse-glimmer:30b': 'Muse Glimmer',
  'nimble:9b': 'Nimble',
  'mistral-small:24b': 'Mistral Small',
  'llama3.1:8b': 'Llama 3.1',
  'codegemma:7b': 'CodeGemma',
  'medgemma:4b': 'MedGemma',
  'Goedel-Prover-V2': 'Goedel Prover',
};

String modelName(String id) => modelNames[id] ?? id;

// Models for one special task. The model menu shows them last.
final specialistModels = [RegExp('medgemma', caseSensitive: false), RegExp('goedel', caseSensitive: false), RegExp('codegemma', caseSensitive: false)];

// The order of the model menu: the preferred models, then the other models, then the specialist models.
List<String> menuOrder(List<String> ids) {
  int rank(String id) {
    final preferred = preferredModels.indexWhere((re) => re.hasMatch(id));
    if (preferred >= 0) return preferred;
    return specialistModels.any((re) => re.hasMatch(id)) ? preferredModels.length + 1 : preferredModels.length;
  }

  final order = [for (var i = 0; i < ids.length; i++) i]..sort((a, b) => rank(ids[a]) != rank(ids[b]) ? rank(ids[a]).compareTo(rank(ids[b])) : a.compareTo(b));
  return [for (final i in order) ids[i]];
}

// CatChat lists alias names (for example "opus") that are not the real model, and embedding models that cannot chat.
final hiddenModels = [
  RegExp('claude', caseSensitive: false),
  RegExp('opus', caseSensitive: false),
  RegExp('sonnet', caseSensitive: false),
  RegExp('haiku', caseSensitive: false),
  RegExp('embed', caseSensitive: false),
];

// The models that the menu shows.
List<String> visibleModels(Iterable<String> ids) => ids.where((id) => !hiddenModels.any((re) => re.hasMatch(id))).toList();

// The model at the start: the saved model if CatChat still has it, then the first preferred match, then the first model.
String? pickModel(List<String> ids, String? saved) {
  if (ids.isEmpty) return null;
  if (saved != null && ids.contains(saved)) return saved;
  for (final re in preferredModels) {
    for (final id in ids) {
      if (re.hasMatch(id)) return id;
    }
  }
  return ids.first;
}
