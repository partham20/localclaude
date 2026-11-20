// End-to-end steps for OpenCode as a third engine: set up with OpenCode only (no Claude sign-in),
// chat through a scripted OpenCode (LOCALCLAUDE_OPENCODE → fake-opencode.mjs, speaking ACP the way
// OpenCode 2.3 does), a command that asks first, provider keys and the models they bring, Plan mode,
// and switching a chat's harness with the conversation carried over.

const KEY = 'sk-TEST-ONLY-openai-key-not-real-0123456789'
const modelMenu = "__t.click(__t.q('.composer-below .below-menu[title*=\"model\"] .menu-trigger') ?? __t.qa('.composer-below .below-menu .menu-trigger').find((t) => t.querySelector('.model-name')))"
const lastTurn = "__t.qa('.turn').at(-1).innerText"
const expectIn = async (c, wants) => {
  const text = await c.page(lastTurn)
  for (const want of wants) if (!text.includes(want)) throw new Error(`expected ${want} in ${JSON.stringify(text)}`)
}

export const steps = [
  {
    name: 'opencode: setup offers OpenCode, and it needs no account',
    run: async (c) => {
      await c.waitFor('the setup screen', "__t.qa('.method').length === 5")
      await c.page("__t.click(__t.q('.method[data-method=\"opencode\"]'))")
      await c.page("__t.click(__t.q('.setup-continue'))")
      await c.waitFor('the OpenCode page', "__t.text('.step-head h2') === 'Use OpenCode'")
      // OpenCode is found (here: the scripted one), so there's nothing to download
      await c.waitFor('OpenCode found', "__t.text('.opencode-found').includes('is ready')")
      await c.shot('opencode-setup')
      await c.waitFor('the button is on', "!__t.q('.opencode-use').disabled")
      await c.page("__t.click(__t.q('.opencode-use'))")
      await c.waitFor('pick a look', "__t.text('.setup-hero h1').includes('Make it yours')")
      await c.page("__t.click(__t.q('.setup-continue'))")
      await c.waitFor('the app, without a Claude sign-in', "!!__t.q('.sidebar') && !__t.q('.setup-card')")
    }
  },
  {
    name: 'opencode: a new chat runs on OpenCode, with its free model and build agent',
    run: async (c) => {
      await c.page("__t.click(__t.q('.side-new'))")
      await c.waitFor('the OpenCode tag', "__t.text('.engine-tag') === 'OpenCode'")
      await c.send('hello there', 'OpenCode says: hello there')
      await c.send('what do you know', 'OpenCode facts:')
      await expectIn(c, ['model=opencode/big-pickle', 'mode=build', 'rules=shell:ask,webfetch:ask,external_directory:ask,edit:ask', 'update=disable', 'autoupdate=off', 'openai=no'])
    }
  },
  {
    name: 'opencode: a command asks first, and shows as the usual step card',
    run: async (c) => {
      await c.send('please run a command')
      await c.waitFor('permission card', "__t.text('.perm-card .perm-title').includes('Allow OpenCode to use Bash')")
      await c.waitFor('the command', "__t.text('.perm-card').includes('ls')")
      await c.shot('opencode-permission')
      await c.page("__t.click(__t.byText('.perm-card .btn', 'Allow once'))")
      await c.waitFor('ran', "__t.qa('.turn').some((t) => t.innerText.includes('OpenCode found two files.')) && !__t.q('.send.stop')", 15000)
      await c.waitFor('the command step', "__t.qa('.turn').some((t) => t.innerText.includes('Ran a command'))")
      await c.shot('opencode-chat')
    }
  },
  {
    name: 'opencode: Settings → OpenCode saves a provider key, and its models show up',
    run: async (c) => {
      await c.openSettings('OpenCode')
      await c.waitFor('the OpenCode page', "__t.text('.modal h2') === 'OpenCode' && __t.text('.modal .opencode-found').includes('is ready')")
      await c.waitFor('OpenCode is the default', "__t.q('.engine-default .seg.on')?.dataset.engine === 'opencode'")
      await c.waitFor('credit', "__t.text('.opencode-credit').includes('MIT License')")
      // a bad variable name is refused
      await c.page("__t.q('.opencode-key-provider').value = 'other'; __t.q('.opencode-key-provider').dispatchEvent(new Event('change', { bubbles: true }))")
      await c.waitFor('the name box', "!!__t.q('.opencode-key-form input[placeholder=\"PROVIDER_API_KEY\"]')")
      await c.page("__t.setValue(__t.q('.opencode-key-form input[placeholder=\"PROVIDER_API_KEY\"]'), 'PATH')")
      await c.page("__t.setValue(__t.q('.opencode-key-input'), 'x')")
      await c.page("__t.click(__t.q('.opencode-key-form button[type=submit]'))")
      await c.waitFor('refused', "__t.text('.opencode-key-error').includes('can’t be set')")
      // OpenAI's key
      await c.page("__t.q('.opencode-key-provider').value = 'OPENAI_API_KEY'; __t.q('.opencode-key-provider').dispatchEvent(new Event('change', { bubbles: true }))")
      await c.page(`__t.setValue(__t.q('.opencode-key-input'), ${JSON.stringify(KEY)})`)
      await c.page("__t.click(__t.q('.opencode-key-form button[type=submit]'))")
      await c.waitFor('saved', "__t.qa('.opencode-key').some((k) => k.textContent.includes('OPENAI_API_KEY'))")
      if (await c.page(`document.body.innerHTML.includes(${JSON.stringify(KEY)})`)) throw new Error('the key is in the page')
      await c.shot('opencode-settings')
      await c.closeModal()
      // the idle chat restarts with the key: its model list now has OpenAI's
      await c.send('what do you know', 'OpenCode facts:')
      await expectIn(c, ['openai=yes'])
      await c.page(modelMenu)
      await c.waitFor('grouped models', "!!__t.byText('.menu-section', 'openai') && !!__t.byText('.menu-item', 'GPT-5.5') && !!__t.byText('.menu-item', 'Big Pickle')")
      await c.waitFor('the harnesses', "!!__t.byText('.menu-item', 'OpenCode') && !!__t.byText('.menu-item', 'DeepSeek Harness') && !!__t.byText('.menu-item', 'Claude Code')")
      await c.shot('opencode-model-menu')
      await c.menuItem('GPT-5.5')
      await c.waitFor('model shown', "__t.text('.composer-below .model-name') === 'GPT-5.5'")
      await c.send('what do you know', 'OpenCode facts:')
      await expectIn(c, ['model=openai/gpt-5.5'])
    }
  },
  {
    name: 'opencode: Plan mode is OpenCode’s plan agent',
    run: async (c) => {
      await c.page("__t.click(__t.q('.composer-below .below-menu[class*=\"mode-\"] .menu-trigger'))")
      await c.menuItem('Plan mode')
      await c.waitFor('plan picked', "!!__t.q('.below-menu.mode-plan')")
      await c.sleep(300)
      await c.send('what do you know', 'OpenCode facts:')
      await expectIn(c, ['mode=plan'])
    }
  },
  {
    name: 'opencode: stop a reply',
    run: async (c) => {
      await c.page("__t.setValue(__t.q('.composer-input'), 'slow please'); __t.key(__t.q('.composer-input'), 'Enter')")
      await c.waitFor('working', "!!__t.q('.send.stop')")
      await c.sleep(300)
      await c.page("__t.click(__t.q('.send.stop'))")
      await c.waitFor('stopped', "__t.qa('.sys-note').some((n) => n.textContent.includes('Stopped')) && !__t.q('.send.stop')")
    }
  },
  {
    name: 'switch harness: the chat moves from OpenCode to Claude Code and back, keeping the conversation',
    run: async (c) => {
      await c.page(modelMenu)
      await c.menuItem('Claude Code')
      await c.waitFor('switched', "__t.qa('.sys-note').some((n) => n.textContent.includes('Switched to Claude Code')) && !__t.q('.engine-tag')")
      await c.waitFor('history kept', "__t.qa('.turn').some((t) => t.innerText.includes('OpenCode found two files.'))")
      await c.send('after the switch', 'Echo: after the switch')
      await c.page("__t.key(window, 'k', { ctrlKey: true, code: 'KeyK' })")
      await c.waitFor('palette', "!!__t.q('.palette')")
      await c.page("__t.setValue(__t.q('.palette input'), 'switch harness')")
      await c.waitFor('the command', "!!__t.byText('.palette-item', 'move this chat to OpenCode')")
      await c.page("__t.click(__t.byText('.palette-item', 'move this chat to OpenCode'))")
      await c.waitFor('back on OpenCode', "__t.text('.engine-tag') === 'OpenCode' && __t.qa('.sys-note').some((n) => n.textContent.includes('Switched to OpenCode'))")
      await c.send('hello again', 'OpenCode says: hello again (with earlier messages)')
      await c.shot('opencode-switched')
    }
  },
  {
    name: 'opencode: Account offers a Claude sign-in, and signing out goes back to setup',
    run: async (c) => {
      await c.openSettings('Account')
      await c.waitFor('OpenCode only', "__t.text('.modal').includes('OpenCode only') && !!__t.byText('.modal .btn', 'Sign in to Claude')")
      await c.page("__t.click(__t.byText('.modal .btn.danger', 'Sign out'))")
      await c.waitFor('the setup screen again', "__t.qa('.method').length === 5")
    }
  }
]
