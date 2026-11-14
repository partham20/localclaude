// End-to-end steps for DeepSeek Harness as a second engine: set up with a DeepSeek key only (no
// Claude sign-in), chat through a scripted dsh (LOCALCLAUDE_DSH → fake-dsh.mjs, speaking ACP),
// tools, a sandbox escape that asks first, model and effort, stopping, and switching a chat's
// harness both ways with the conversation carried over.

const KEY = 'sk-TEST-ONLY-deepseek-key-not-real-0123456789'
const reply = (text) => `__t.qa('.turn').some((t) => t.innerText.includes(${JSON.stringify(text)})) && !__t.q('.send.stop')`
const modelMenu = "__t.click(__t.q('.composer-below .below-menu[title*=\"model\"] .menu-trigger') ?? __t.qa('.composer-below .below-menu .menu-trigger').find((t) => t.querySelector('.model-name')))"

export const steps = [
  {
    name: 'deepseek: setup offers DeepSeek Harness, and a DeepSeek key is enough',
    run: async (c) => {
      await c.waitFor('the setup screen', "__t.qa('.method').length === 4")
      await c.page("__t.click(__t.q('.method[data-method=\"deepseek\"]'))")
      await c.page("__t.click(__t.q('.setup-continue'))")
      await c.waitFor('the DeepSeek page', "__t.text('.step-head h2') === 'Use DeepSeek Harness'")
      // dsh is found (here: the scripted one), so there's nothing to install
      await c.waitFor('dsh found', "__t.text('.deepseek-found').includes('is ready')")
      await c.shot('deepseek-setup')
      await c.page("__t.click(__t.q('.setup-form button[type=submit]'))")
      await c.page(`__t.setValue(__t.q('.secret-input input'), ${JSON.stringify('short')})`)
      await c.page("__t.click(__t.q('.setup-form button[type=submit]'))")
      await c.waitFor('too short', "__t.text('.setup-error').includes('too short')")
      await c.page(`__t.setValue(__t.q('.secret-input input'), ${JSON.stringify(KEY)})`)
      await c.page("__t.click(__t.q('.setup-form button[type=submit]'))")
      await c.waitFor('pick a look', "__t.text('.setup-hero h1').includes('Make it yours')")
      await c.page("__t.click(__t.q('.setup-continue'))")
      await c.waitFor('the app, without a Claude sign-in', "!!__t.q('.sidebar') && !__t.q('.setup-card')")
      if (await c.page(`document.body.innerHTML.includes(${JSON.stringify(KEY)})`)) throw new Error('the key is in the page')
    }
  },
  {
    name: 'deepseek: a new chat runs on DeepSeek Harness',
    run: async (c) => {
      await c.page("__t.click(__t.q('.side-new'))")
      await c.waitFor('the DeepSeek tag', "__t.text('.engine-tag') === 'DeepSeek'")
      await c.send('hello there', 'DeepSeek says: hello there')
      // its thinking is kept, and the context ring fills from dsh's usage
      await c.waitFor('disclaimer', "__t.text('.disclaimer').includes('DeepSeek is AI')")
    }
  },
  {
    name: 'deepseek: its tools show as the usual step cards',
    run: async (c) => {
      await c.send('please run a command', 'There are two files.')
      // dsh's bash is shown as Claude Code's Bash: summed up as "Ran a command"
      await c.waitFor('the command step', "__t.qa('.turn').some((t) => t.innerText.includes('Ran a command'))")
      await c.shot('deepseek-chat')
    }
  },
  {
    name: 'deepseek: stepping outside its sandbox asks first',
    run: async (c) => {
      await c.send('write outside the folder')
      await c.waitFor('permission card', "__t.text('.perm-card .perm-title').includes('Allow DeepSeek Harness to use Write')")
      await c.waitFor('its reason', "__t.text('.perm-card').includes('The note belongs in /elsewhere')")
      await c.shot('deepseek-permission')
      await c.page("__t.click(__t.byText('.perm-card .btn', 'Allow once'))")
      await c.waitFor('written', reply('Wrote the note outside.'), 15000)
    }
  },
  {
    name: 'deepseek: dsh’s own models, effort, sandbox mode and key reach it',
    run: async (c) => {
      await c.page(modelMenu)
      await c.waitFor('the harness section', "!!__t.byText('.menu-item', 'DeepSeek Harness') && !!__t.byText('.menu-item', 'Claude Code')")
      await c.shot('deepseek-model-menu')
      await c.menuItem('DeepSeek-V4-Pro')
      await c.waitFor('model shown', "__t.text('.composer-below .model-name') === 'DeepSeek-V4-Pro'")
      await c.page(modelMenu)
      await c.menuItem('Max')
      await c.waitFor('effort shown', "__t.text('.composer-below').includes('Max')")
      await c.send('what do you know', 'DeepSeek facts:')
      const text = await c.page("__t.qa('.turn').at(-1).innerText")
      for (const want of ['mode=workspace-write', 'key=yes', 'node=electron', 'model=deepseek-v4-pro', 'effort=max'])
        if (!text.includes(want)) throw new Error(`expected ${want} in ${JSON.stringify(text)}`)
    }
  },
  {
    name: 'deepseek: stop a reply',
    run: async (c) => {
      await c.page("__t.setValue(__t.q('.composer-input'), 'slow please'); __t.key(__t.q('.composer-input'), 'Enter')")
      await c.waitFor('working', "!!__t.q('.send.stop')")
      await c.sleep(300)
      await c.page("__t.click(__t.q('.send.stop'))")
      await c.waitFor('stopped', "__t.qa('.sys-note').some((n) => n.textContent.includes('Stopped')) && !__t.q('.send.stop')")
    }
  },
  {
    name: 'switch harness: the chat moves to Claude Code and back, keeping the conversation',
    run: async (c) => {
      await c.page(modelMenu)
      await c.menuItem('Claude Code')
      await c.waitFor('switched', "__t.qa('.sys-note').some((n) => n.textContent.includes('Switched to Claude Code')) && !__t.q('.engine-tag')")
      // the earlier DeepSeek turns are still there
      await c.waitFor('history kept', "__t.qa('.turn').some((t) => t.innerText.includes('There are two files.'))")
      await c.send('after the switch', 'Echo: after the switch')
      // and back again, with Ctrl+K
      await c.page("__t.key(window, 'k', { ctrlKey: true, code: 'KeyK' })")
      await c.waitFor('palette', "!!__t.q('.palette')")
      await c.page("__t.setValue(__t.q('.palette input'), 'switch harness')")
      await c.waitFor('the command', "!!__t.byText('.palette-item', 'move this chat to DeepSeek Harness')")
      await c.page("__t.click(__t.byText('.palette-item', 'move this chat to DeepSeek Harness'))")
      await c.waitFor('back on DeepSeek', "__t.text('.engine-tag') === 'DeepSeek' && __t.qa('.sys-note').some((n) => n.textContent.includes('Switched to DeepSeek Harness'))")
      await c.send('hello again', 'DeepSeek says: hello again (with earlier messages)')
      await c.shot('deepseek-switched')
    }
  },
  {
    name: 'deepseek: Settings → DeepSeek, and new chats can default to Claude Code',
    run: async (c) => {
      await c.openSettings('DeepSeek')
      await c.waitFor('the DeepSeek page', "__t.text('.modal h2') === 'DeepSeek Harness' && __t.text('.deepseek-key-status').includes('saved')")
      await c.waitFor('dsh found', "__t.text('.modal .deepseek-found').includes('is ready')")
      await c.waitFor('DeepSeek is the default', "__t.q('.engine-default .seg.on')?.dataset.engine === 'deepseek'")
      await c.shot('deepseek-settings')
      await c.page("__t.click(__t.q('.engine-default .seg[data-engine=\"claude\"]'))")
      await c.waitFor('Claude is the default', "__t.q('.engine-default .seg.on')?.dataset.engine === 'claude'")
      await c.closeModal()
      await c.page("__t.click(__t.q('.side-new'))")
      await c.waitFor('a Claude chat', "!!__t.q('.composer-input') && !__t.q('.msg-user') && !__t.q('.engine-tag')")
      await c.send('hi claude', 'Echo: hi claude')
    }
  },
  {
    name: 'deepseek: Account offers a Claude sign-in, and signing out removes the key',
    run: async (c) => {
      await c.openSettings('Account')
      await c.waitFor('DeepSeek only', "__t.text('.modal').includes('DeepSeek Harness only') && !!__t.byText('.modal .btn', 'Sign in to Claude')")
      await c.page("__t.click(__t.byText('.modal .btn.danger', 'Sign out'))")
      await c.waitFor('the setup screen again', "__t.qa('.method').length === 4")
    }
  }
]
