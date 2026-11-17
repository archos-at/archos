'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { I18nProvider } from '@/i18n'
import { AppConfigProvider, type AppConfig } from '@/shared/context'
import { getFileUploadConfigFromEnv } from '@/shared/config/file-upload'
import { ChatArea } from '@/features/layout/components'
import { InputArea } from '@/features/layout/components/InputArea'
import { useChatStore } from '@/features/chat/store'
import type { Conversation } from '@/features/chat/types'
import { installFakeSocket, stubApi } from './fake-socket'
import { PROJECT_ID, SCENARIO_IDS, SCENARIOS, type ScenarioId } from './scenarios'

const config: AppConfig = { authRequired: false, fileUpload: getFileUploadConfigFromEnv() }

const USER = 'default-user'
const HARNESS_STORAGE_KEY = 'chat-store:turn-outcomes'
const CONVERSATION_ID = 'turn-outcomes'

interface TurnOutcomesProbe {
  scenario: ScenarioId
  sentAt: number
  bodies: { t: number; type: string; name?: string }[]
}

declare global {
  interface Window {
    __turnOutcomes?: TurnOutcomesProbe
  }
}

const openConversation = (project: boolean): Conversation => ({
  id: CONVERSATION_ID,
  userId: USER,
  projectId: project ? PROJECT_ID : null,
  title: 'Turn outcomes',
  messages: [],
  createdAt: new Date(2026, 9, 1, 9),
  updatedAt: new Date(2026, 9, 1, 9),
})

const sendFromComposer = (question: string): boolean => {
  const textarea = document.querySelector<HTMLTextAreaElement>('textarea')
  if (!textarea) return false
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
    textarea,
    question
  )
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
  window.setTimeout(() => {
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true })
    )
  }, 50)
  return true
}

const autoAnswer = (id: ScenarioId): void => {
  const respond = useChatStore.getState().respondToInteractionFn
  if (id === 'hitl_choice') respond?.('gk4')
  if (id === 'hitl_plan') respond?.('approve')
  if (id === 'proposal_accept') {
    const accept = [...document.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Übernehmen')
    )
    accept?.click()
  }
}

const isScenario = (value: string | null): value is ScenarioId =>
  SCENARIO_IDS.includes(value as ScenarioId)

export default function TurnOutcomesPage() {
  const params = useSearchParams()
  const requested = params.get('scenario')
  const id: ScenarioId = isScenario(requested) ? requested : 'handed_off'
  const auto = params.get('auto') === '1'
  const scenario = SCENARIOS[id]
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const probe: TurnOutcomesProbe = { scenario: id, sentAt: 0, bodies: [] }
    window.__turnOutcomes = probe
    const timers: number[] = []
    const at = (ms: number, run: () => void) => timers.push(window.setTimeout(run, ms))
    let connected = false

    const uninstallSocket = installFakeSocket(scenario, {
      onOpen: () => (connected = true),
      onBody: (body) => {
        probe.bodies.push({
          t: Math.round(performance.now() - probe.sentAt),
          type: String(body.type),
          ...(typeof body.name === 'string' ? { name: body.name } : {}),
        })
        const asks =
          body.name === 'interaction_request' || (body.name === 'card' && id === 'proposal_accept')
        if (auto && asks) at(1500, () => autoAnswer(id))
      },
    })
    const restoreFetch = stubApi(scenario)

    const previous = useChatStore.getState()
    const persistedAs = useChatStore.persist.getOptions().name
    useChatStore.persist.setOptions({ name: HARNESS_STORAGE_KEY })
    const conversation = openConversation(Boolean(scenario.project))
    useChatStore.setState({
      currentUserId: USER,
      currentConversation: conversation,
      conversations: [conversation],
      projectId: scenario.project ? PROJECT_ID : null,
      hasHydrated: true,
    })
    setReady(true)

    const sendWhenOpen = () => {
      if (connected && sendFromComposer(scenario.question)) {
        probe.sentAt = performance.now()
        if (scenario.stopAt !== undefined)
          at(scenario.stopAt, () => useChatStore.getState().stopStreaming?.())
        return
      }
      at(100, sendWhenOpen)
    }
    at(500, sendWhenOpen)

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer))
      restoreFetch()
      uninstallSocket()
      useChatStore.setState(previous)
      useChatStore.persist.clearStorage()
      useChatStore.persist.setOptions({ name: persistedAs })
    }
  }, [id, auto, scenario])

  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <AppConfigProvider config={config}>
        <div className="bg-background flex h-screen flex-col">
          <nav
            className="border-border flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-xs"
            aria-label="Scenarios"
          >
            {SCENARIO_IDS.map((scenarioId) => (
              <Link
                key={scenarioId}
                href={`/dev/turn-outcomes?scenario=${scenarioId}${auto ? '&auto=1' : ''}`}
                className={
                  scenarioId === id
                    ? 'text-foreground font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                }
                prefetch={false}
                onClick={(event) => {
                  event.preventDefault()
                  window.location.assign(
                    `/dev/turn-outcomes?scenario=${scenarioId}${auto ? '&auto=1' : ''}`
                  )
                }}
              >
                {SCENARIOS[scenarioId].label}
              </Link>
            ))}
          </nav>
          <p className="text-muted-foreground px-4 py-2 text-xs" data-testid="turn-outcomes-note">
            {scenario.note}
          </p>
          {ready && (
            <>
              <ChatArea isAuthenticated />
              <InputArea isAuthenticated connectionMode="websocket" />
            </>
          )}
        </div>
      </AppConfigProvider>
    </I18nProvider>
  )
}
