/**
 * The copy-and-paste pieces Settings, Siri and assistants hands out: Shortcuts recipes, Home
 * Assistant YAML, the Alexa skill's interaction model and the commands that add Mantel to
 * Claude. Each takes the household's address and a token (or a placeholder until one is made).
 */

export const TOKEN_PLACEHOLDER = 'PASTE_YOUR_TOKEN_HERE';

export interface ShortcutField {
  label: string;
  value: string;
}

export interface ShortcutRecipe {
  id: 'say' | 'share' | 'today';
  title: string;
  phrase: string;
  summary: string;
  steps: string[];
  fields: ShortcutField[];
}

export function shortcutRecipes(base: string, token: string): ShortcutRecipe[] {
  const auth = `Bearer ${token}`;
  return [
    {
      id: 'say',
      title: 'Add to Mantel by voice',
      phrase: '"Hey Siri, add to Mantel"',
      summary:
        'Siri asks "What should I add?", you say "milk and eggs" or "dentist Tuesday at 3", and Siri reads back what Mantel did.',
      steps: [
        'Open the Shortcuts app, tap +, and name the shortcut "Add to Mantel" (that name is what you say to Siri).',
        'Add the action Dictate Text (or Ask for Input, with the prompt "What should I add?").',
        'Add Get Contents of URL. Paste the URL below, tap Show More, set Method to POST.',
        'Under Headers add Authorization with the value below. Under Request Body choose JSON and add a Text field named text set to the Dictated Text.',
        'Add Get Dictionary Value: get the value for key speech in Contents of URL.',
        'Add Speak Text (or Show Result) with the Dictionary Value. Done.',
      ],
      fields: [
        { label: 'URL', value: `${base}/api/say` },
        { label: 'Method', value: 'POST' },
        { label: 'Header: Authorization', value: auth },
        { label: 'JSON body: text', value: 'Dictated Text' },
        { label: 'Read back key', value: 'speech' },
      ],
    },
    {
      id: 'share',
      title: 'Send to Mantel from the share sheet',
      phrase: 'Share › Send to Mantel',
      summary:
        'Share a line of text, a note or a link from any app. Mantel reads it the same way as a spoken phrase.',
      steps: [
        'Make a new shortcut named "Send to Mantel". Tap the (i) button and turn on Show in Share Sheet; accept Text and URLs.',
        'Add Get Contents of URL with the URL, method, header and body below (text set to Shortcut Input).',
        'Add Get Dictionary Value for speech, then Show Notification with it.',
      ],
      fields: [
        { label: 'URL', value: `${base}/api/say` },
        { label: 'Method', value: 'POST' },
        { label: 'Header: Authorization', value: auth },
        { label: 'JSON body: text', value: 'Shortcut Input' },
        { label: 'JSON body: source', value: 'share' },
      ],
    },
    {
      id: 'today',
      title: "What's on today",
      phrase: '"Hey Siri, what\'s on today"',
      summary:
        'Siri reads the day: weather, what is on the calendar, dinner, the grocery list and chores left.',
      steps: [
        'Make a new shortcut named "What\'s on today".',
        'Add Get Contents of URL with the URL and the Authorization header below (method GET).',
        'Add Speak Text with Contents of URL. For tomorrow, make a copy with ?day=tomorrow on the end of the URL.',
      ],
      fields: [
        { label: 'URL', value: `${base}/api/today.txt` },
        { label: 'Header: Authorization', value: auth },
      ],
    },
  ];
}

/** Home Assistant: a rest_command and Assist sentences that hand any phrase to `/api/say`. */
export function homeAssistantYaml(base: string, token: string): string {
  return `# configuration.yaml — lets Home Assistant (Assist, automations, Alexa through HA) add to Mantel.
rest_command:
  mantel_say:
    url: "${base}/api/say"
    method: post
    headers:
      authorization: "Bearer ${token}"
    content_type: "application/json"
    payload: '{"text": {{ text | tojson }}, "source": "voice"}'

intent_script:
  MantelAdd:
    action:
      - action: rest_command.mantel_say
        data:
          text: "{{ thing }}"
    speech:
      text: "Okay, sent {{ thing }} to Mantel."
`;
}

/** Assist sentences with a free-form slot: "add milk and eggs to Mantel". */
export function assistSentences(): string {
  return `# config/custom_sentences/en/mantel.yaml
language: "en"
intents:
  MantelAdd:
    data:
      - sentences:
          - "(add|put) {thing} (to|on) mantel"
          - "tell mantel [to] {thing}"
          - "mantel add {thing}"
lists:
  thing:
    wildcard: true
`;
}

/** An Alexa routine-free path: a custom skill whose endpoint is Mantel itself. */
export function alexaEndpoint(base: string, token: string): string {
  return `${base}/api/alexa?token=${encodeURIComponent(token)}`;
}

/** The skill's interaction model (Alexa developer console › JSON Editor). */
export function alexaModel(invocation = 'mantel'): string {
  return JSON.stringify(
    {
      interactionModel: {
        languageModel: {
          invocationName: invocation,
          intents: [
            {
              name: 'AddIntent',
              slots: [{ name: 'thing', type: 'AMAZON.SearchQuery' }],
              samples: [
                'add {thing}',
                'to add {thing}',
                'put {thing}',
                'we need {thing}',
                'note {thing}',
              ],
            },
            {
              name: 'TodayIntent',
              slots: [],
              samples: ["what's on today", 'what is on today', 'what is happening today'],
            },
            {
              name: 'TomorrowIntent',
              slots: [],
              samples: ["what's on tomorrow", 'what is on tomorrow'],
            },
            { name: 'AMAZON.HelpIntent', samples: [] },
            { name: 'AMAZON.StopIntent', samples: [] },
            { name: 'AMAZON.CancelIntent', samples: [] },
            { name: 'AMAZON.FallbackIntent', samples: [] },
          ],
          types: [],
        },
      },
    },
    null,
    2,
  );
}

/** Claude Code, Claude Desktop (through mcp-remote) and any client that takes a URL and a header. */
export function claudeCommands(base: string, token: string) {
  const url = `${base}/mcp`;
  return {
    url,
    header: `Authorization: Bearer ${token}`,
    claudeCode: `claude mcp add --transport http mantel ${url} --header "Authorization: Bearer ${token}"`,
    desktopJson: JSON.stringify(
      {
        mcpServers: {
          mantel: {
            command: 'npx',
            args: ['-y', 'mcp-remote', url, '--header', `Authorization: Bearer ${token}`],
          },
        },
      },
      null,
      2,
    ),
  };
}
