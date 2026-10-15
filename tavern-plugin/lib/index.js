import { createStoryAlignment } from './domain/story-alignment.js'
import { createCardTextReplacement } from './domain/card-text-replace.js'
import {assertOriginalSpRollbackReceipt,assertOriginalSpDeletionReceipt} from './domain/tavern-original-extension.js'
import {isDeepStrictEqual} from 'node:util'
import {createSessionReadQueries} from './domain/session-read-queries.js'
import {createMvuConversion} from './domain/mvu-conversion.js'
import {registerMvuConversionTools} from './domain/mvu-conversion-tools.js'
import {disposeMvuConversionBrowser} from './domain/mvu-conversion-browser.js'
import {createGamePackageAssets} from './domain/game-package-assets.js'
import {createGamePackageService} from './domain/game-package.js'
import {createGamePackageTransfer} from './domain/game-package-transfer.js'
import {createGamePackageResources} from './domain/game-package-resources.js'
import {createGamePackageNative} from './domain/game-package-native.js'
import {createScriptVariablePolicy} from './domain/script-variable-policy.js'
import {inspectImportedVariables} from './domain/import-variable-review.js'
import {createGameResourceBindings} from './domain/game-resource-bindings.js'
import {createResourceVersionRegistry} from './domain/resource-version-registry.js'
import {createRetentionScanner} from './domain/retention-scanner.js'
import {installHostSubprocessPatch} from './domain/host-subprocess-patch.js'
import { boundDisplayCaptures } from './domain/display-capture-budget.js'
import {createDisplayDiagnostics,displayMessageIdentity} from './domain/display-diagnostics.js'
import { isRescuedHistoryMessage } from './domain/chat-history-rescue.js'
import { playRuntimeSettings } from './domain/play-runtime-settings.js'
import {fetchGithubScript} from './domain/tavern-github-script.js'
import {frontendGenerationConfig,frontendMainGenerationConfig} from './domain/frontend-generation.js'
import {createPermissionDenials,projectPermissionDenials} from './domain/permission-denials.js'
import {presetSampling,nativePresetSampling,unsupportedPresetSampling,configuredPresetWire,configuredOutputLimit,configuredBackgroundOutput} from './domain/preset-sampling.js'
import {selectFrontendWorldInfo} from './domain/frontend-world-info.js'
import { selectCompatibilityWorldInfo } from './domain/compatibility-worldbook.js'
import {createOriginalSpCatalog} from './domain/original-sp-catalog.js'
import { createTavernRequestGate, tavernResourceHeaders } from './domain/tavern-request-gate.js'
import {readCapacitySettings,createCapacitySettings} from './domain/capacity-settings.js'
import {createRollingDiagnosticStorage} from './domain/rolling-diagnostics.js'
import '../../bin/offline-network.mjs'
import {outboundDisabled,assertOutboundEnabled} from './domain/outbound-network-policy.js'
import { readToolPage, TOOL_READ_PAGE_SCHEMA } from './domain/tool-read-page.js'
import { createTavernToolRestrictions } from './domain/tavern-tool-restrictions.js'
import {nativeHelperMessages} from './domain/helper-native-model.js'
import {createInputEditor} from './domain/input-editor.js'
import { createTavernScriptImages } from './domain/tavern-script-images.js'
import { createTavernChatTransfer, prepareTransferredChat } from './domain/tavern-chat-transfer.js'
import { createTavernChatFiles } from './domain/tavern-chat-files.js'
import { createSpFillWorldbook,projectSpWorldbookMirror } from './domain/sp-fill-worldbook.js'
import { exportSpCheckpoint } from './domain/sp-checkpoint.js'
import { createHelperWorldbookLibrary } from './domain/tavern-helper-worldbook-library.js'
import { projectHelperSystemHistory } from './domain/helper-system-history.js'
import { admitHelperImages, nativeHelperTools, needsHelperWireOptions, callConfiguredHelperApi, createHelperToolAccumulator } from './domain/helper-native-model.js'
import { createTavernScriptOwnerGuard } from './domain/tavern-script-owner.js'
import {createCardPermissions,cardExecutableIdentity,authorizeScriptOperation,isOfficialMvuActivityWrite,COMPATIBILITY_CAPABILITIES,mergeScriptPolicies} from './domain/card-permissions.js'
import {createOneTimeApprovals} from './domain/one-time-approvals.js'
import {createFrameResources} from './domain/frame-resources.js'
import { createFullTemplateWorldbookCycles } from './domain/full-prompt-template-worldbook-cycle.js'
import { projectTemplateWorldbookEntries, restoreTemplateWorldbookEntries } from './domain/full-prompt-template-worldbook.js'
import { createNativePresetLibrary } from './domain/helper-native-presets.js'
import { createTavernScriptAssetCache } from './domain/tavern-script-asset-cache.js'
import { applyNativeSessionUpgrade } from './domain/native-session-upgrade.js'
import { projectNativeHistoryVisibility } from './domain/session-history-edit.js'
import { appendAssistantEvent, authoredTurnMappings, tavernAssistantTurn } from './domain/session-surface-edit.js'
import { clearLegacyTavernDefault } from './domain/legacy-agent-default.js'
import { conversationStateAtTurn, conversationForkBoundary, conversationForkTurnsByMessageId } from './domain/conversation-fork-point.js'
import { createCardResponseTest } from './domain/card-response-test.js'
import { prependSystemInstruction } from './domain/system-append.js'
import { createGameplayApi } from './gameplay-api.js'
import { cardOpeningChoices } from './domain/card-openings.js'
import { marked } from 'marked'
import { presentModelError } from './domain/model-error-presentation.js'
import { validateCardFile, validateCardText } from './domain/card-validation.js'
import { resolveAgentCompaction } from './agent-compaction.js'
import { createAutoCompaction, installCompactionPolicy } from './domain/auto-compaction.js'
import { observeHttpRequests } from './domain/http-performance-diagnostics.js'
import { createPerformanceDiagnostics } from './domain/performance-diagnostics.js'
import { backgroundSuppressedTurns } from './domain/background-surface.js'
import { ensureCardWorkspaceMessage } from './domain/card-workspace-message.js'
import { createPromptTemplateGlobalVariables } from './domain/prompt-template-global-variables.js'
import { FULL_PROMPT_TEMPLATE_ASSET_PREFIX, readFullPromptTemplateAsset } from './domain/full-prompt-template-assets.js'
import { createTavernApiDiagnostics } from './domain/tavern-api-diagnostics.js'
import { generateHelperRaw } from './domain/helper-generation.js'
import { createMigrationSettings, effectiveGamePreset, gamePresetControls, changeGamePreset, realUserText } from './domain/st-game-features.js'
import { createPresetCommand } from './domain/preset-command.js'
import { createToolWorkbench } from './domain/tool-workbench.js'
import { createSpStorageStore } from './domain/sp-storage.js'
import { createSpCompanion } from './domain/sp-companion.js'
import { createSpAdvanced } from './domain/sp-advanced.js'
import { createTavernExtensionRuntime } from './domain/tavern-extension-runtime.js'
import { createSpDatabase, databaseState } from './domain/sp-database.js'
import { createSpConfigurationLibrary } from './domain/sp-configuration-library.js'
import { planSpTemplateChange } from "./domain/sp-database.js"
import { createSpTemplateLibrary, importSpTemplate } from './domain/sp-template-library.js'
import { createTavernHistoryOperations } from './domain/tavern-history-operations.js'
import { createBodyEditor, synchronizeBodyEdits } from './domain/body-editor.js'
import { appendHelperUserSessionContext } from './domain/helper-user-session-context.js'
import { sessionOpeningDescriptor, prepareSessionOpening } from './domain/session-opening.js'
import { scriptPromptScanText } from './domain/tavern-script-prompts.js'
import { openingCommandHistory, openingCommandPrompt, consumeOpeningCommandPrompt } from './domain/opening-command.js'
import { createOpeningPreparation } from './domain/opening-preparation.js'
import { createChatHistoryImportService } from './domain/chat-history-import-service.js'
import { createImportContextPreparation, needsImportContextPreparation } from './domain/import-context-preparation.js'
import { sessionEvents, appendSessionEvent } from './domain/session-events.js'
import {readDisplayedMessageIdentity} from './domain/displayed-message-identity.js'
import { tavernSourceDiagnostics } from './domain/session-message-source.js'
import { isTavernTurnInput, isTavernTriggerInput, tavernTriggerTurnInput, userMessageForTurn, requestIdForTurn } from './domain/tavern-turn-input.js'
import { createTavernTrigger } from './domain/tavern-trigger.js'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { randomUUID, createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createBackgroundAgentRunner, executeBackgroundCompaction } from './background-agent-runner.js'
import {createBackgroundSessionRetirement,createNativeBackgroundRetirement,installRetiredBackgroundFilter} from './domain/background-session-retirement.js'
import {installCompactionRequestProjection,withCompactionAppendix} from './domain/compaction-request.js'
import {inputAttachments,projectPlayerContent} from './domain/player-input-content.js'
import { createApplicationUpdater } from './application-updater.js'
import { CANDIDATE_SUBMIT_TOOL, SCRIPT_POINT_TOOL, SCRIPT_READ_TOOL, createCandidateGenerator } from './domain/candidate-generation.js'
import { createSceneIllustrations, sceneTarget } from './domain/scene-illustration.js'
import { legacyImageConfigurationReader } from './domain/image-generation-host.js'
import { createSceneWorldbooks, sceneWorldbookBinding } from './domain/scene-worldbook.js'
import { createSceneImageDiagnostics, createSceneImageHostLogger, recordSceneImageInteraction } from './domain/scene-image-diagnostics.js'
import { TAVERN_RELEASE_CAPABILITIES } from './domain/release-capabilities.js'
import { createSessionStablePrefixStorage, ensureSessionStablePrefix, readSessionStablePrefix, sessionStablePrefixSections, withCurrentWorldbook } from './domain/session-stable-prefix.js'
import { waitForWritableSession } from './domain/agent-readiness.js'
import { createCardDeletion } from './domain/card-deletion.js'
import { orderCardsByNewestImport } from './domain/card-list-order.js'
import { createCardPreparation } from './domain/card-preparation.js'
import { withGlobalRegexScripts, composeTavernRegexScripts } from './domain/card-extension-reading.js'
import { projectCardOpeningPreviews } from './domain/card-opening-previews.js'
import { compactOpeningResponse } from './domain/opening-response.js'
import { READABLE_CARD_FIELDS, readCardField, searchCardRaw } from './domain/card-reading.js'
import { createConversationInitialization } from './domain/conversation-initialization.js'
import { assertConversationForkable, conversationForkReceipt, forkConversationChat } from './domain/conversation-fork.js'
import { configuredChatBackgroundModel, resolveChatBackgroundModel } from './domain/background-model-selection.js'
import { createForegroundModelSelection, createSettingsOperationQueue, readForegroundModelSelection } from './domain/foreground-model-selection.js'
import { createPlayCardSnapshots, cardContentDigest } from './domain/play-card-snapshots.js'
import {createResourceVersionPanel} from './domain/resource-version-panel.js'
import {createResourceVersionAdapter} from './domain/resource-version-adapter.js'
import { createUserPreferenceProfile } from './domain/user-preference-profile.js'
import { createContextPlanner } from './domain/context-planner.js'
import { createConversationTextExport } from './domain/conversation-text-export.js'
import { createCoordinationEventPublisher } from './domain/coordination-event-publisher.js'
import { createSessionSignalTransport } from './domain/session-signal-transport.js'
import { createCandidateTasks } from './domain/candidate-tasks.js'
import { extractEpubText } from './domain/epub-text.js'
import { createFileResourceStore, normalizeResourcePath, resourceKind } from './domain/file-resources.js'
import {createTemplateEnginePolicy} from './domain/template-engine-policy.js'
import { createMobileCardImport } from './domain/mobile-card-import.js'
import { createForegroundHandoff } from './domain/foreground-handoff.js'
import { createRuntimeNotices } from './domain/runtime-notices.js'
import { createProfileSessionAccess } from './domain/profile-session-access.js'
import { createForegroundFrameBuilder } from './domain/agent-input-frame.js'
import { createForegroundFrameSessionAdapter } from './domain/foreground-frame-session-adapter.js'
import { HISTORY_RECALL_OUTPUT_SCHEMA, HISTORY_RECALL_TOOL, createHistoryRecall, renderHistoryRecall } from './domain/history-recall.js'
import { dshParameterFields } from './domain/dsh-tool-schema.js'
import { WORLD_BOOK_SEARCH_TOOL, createWorldbookSearch } from './domain/worldbook-search.js'
import { sharedWorldbookSearch } from './domain/shared-worldbook-search.js'
import { createGuideLibrary } from './domain/guide-library.js'
import { appendGuides } from './domain/guide-content.js'
import { createModelRequestLog } from './domain/model-request-log.js'
import { MVU_SUBMIT_UPDATE_TOOL, createMvuSettlementModule } from './domain/mvu-background-settlement.js'
import { applyMvuSettlementEffect } from './domain/mvu-settlement-effect.js'
import { createMvuSettlementReconciler } from './domain/mvu-settlement-reconciler.js'
import {
  CHARACTER_DESIGN_READ_TOOL,
  CHARACTER_DESIGN_SAVE_TOOL,
  createCharacterDesignDocumentTools,
  projectCharacterDesignDocument
} from './domain/character-design-document.js'
import { writeCharacterDesignWorldbook, removeCharacterDesignWorldbook, characterDesignWorldbookNote } from './domain/character-design-worldbook.js'
import { createManualCharacterDesign, characterDesignRemovalStamp } from './domain/manual-character-design.js'
import { createLedgerEditor } from './domain/ledger-editor.js'
import { readLedger,createLedgerSubmission,LEDGER_SUBMIT_TOOL,LEDGER_RULES,ledgerContext } from './domain/story-ledger.js'
import { POSTURE_SUBMIT_TOOL, POSTURE_SUBMIT_TOOL_NAME, normalizePostureSubmission } from './domain/posture-submission.js'
import { TAVERN_COMPATIBILITY_CAPABILITIES, createTavernCompatibilityDiagnosticStore } from './domain/tavern-compatibility-diagnostics.js'
import { createMvuDiagnosticStore, createMvuDiagnosticExport, sanitizeRuntimeDiagnostics, sanitizeModuleFailure, sanitizeMvuLoadDiagnostic, redactMvuLoadError } from './domain/mvu-diagnostics.js'
import { projectPersistentStatusView } from './domain/persistent-status-view.js'
import { createPlayChatDebugReference, readPlayChatDebugTurn } from './domain/play-chat-debug.js'
import { createPhoneChat } from './domain/phone-chat.js'
import { createPresetLibrary } from './domain/preset-library.js'
import { resolveRuntimePresetMacros } from './domain/runtime-presets.js'
import { compileSillyTavernRequest, createCleanCompatibilityPreset } from './domain/sillytavern-compatibility.js'
import { applySillyTavernStrictTools } from './domain/sillytavern-strict-tools.js'
import { createForegroundOrchestrationStrategies } from './domain/foreground-orchestration-strategies.js'
import { foregroundSuppressedTurns, clearFailedTurnSurface, hasRollbackMessages, supersededRegenerationErrorTurns } from './domain/rollback-surface.js'
import { assistantResultForTurn } from './domain/session-turn-result.js'
import { createTavernRetryLimiter } from './domain/tavern-retry-limiter.js'
import { lastTavernHelperVariables, projectTavernHelperContext, projectTavernHelperContextReadonly } from './domain/tavern-helper-context.js'
import { projectTavernHelperWorldbook } from './domain/tavern-helper-worldbook.js'
import { applyTavernHelperVariableMacros } from './domain/tavern-helper-variable-macros.js'
import { scriptScopeTrees, projectScriptLibraryForFrame } from './domain/tavern-script-library.js'
import {createIzumiConnection,streamIzumiConnection} from './domain/izumi-connection.js'
import {createHelperPresetLibrary} from './domain/helper-preset-library.js'
import { createPlayManagement } from './domain/play-management.js'
import { createTavernHelperAudio } from './domain/tavern-helper-audio.js'
import { createTavernHelperEventJournal } from './domain/tavern-helper-event-journal.js'
import { createTavernBackgroundScriptExecutor } from './domain/tavern-background-script-executor.js'
import { createHelperPresetVariables } from './domain/helper-preset-variables.js'
import { createHelperGenerationService } from './domain/helper-generation-service.js'
import { createTavernScriptServices, scriptDatabaseSnapshot } from './domain/tavern-script-services.js'
import { createTavernScriptLibrary, resolveTavernScripts, importScriptTrees, flattenScriptTrees } from './domain/tavern-script-library.js'
import { projectTavernHelperScripts, hasTavernScriptRuntime } from './domain/tavern-helper-scripts.js'
import {createFrameUnloadCapabilities} from './domain/frame-unload-capabilities.js'
import { createTavernScriptDispatch } from './domain/tavern-script-dispatch.js'
import { createTavernExtensionSettings } from './domain/tavern-extension-settings.js'
import { createTavernScriptHostAdapter } from './domain/tavern-script-host-adapter.js'
import { createTavernRemoteAssetPinStore } from './domain/tavern-remote-assets.js'
import { OFFICIAL_MVU_VERSION, readOfficialMvuBundle, inspectOfficialMvuAsset } from './domain/official-mvu-assets.js'
import { selectMvuRuntime } from './domain/mvu-runtime-selection.js'
import { TAVERN_RUNTIME_ASSET_PREFIX, readTavernRuntimeAsset } from './domain/tavern-runtime-assets.js'
import {createSpAuthorityService,spAuthorityView} from './domain/sp-authority.js'
import { TAVERN_CLIENT_ASSET_PREFIX, readTavernClientAsset } from './domain/tavern-client-assets.js'
import {createRemoteCacheBudget} from './domain/remote-cache-budget.js'
import { createTavernStaticResourceCache, projectCachedResourceBody, cachedResourceMediaType } from './domain/tavern-static-resource-cache.js'
import { SILLYTAVERN_CSS_COMPAT_URLS } from './domain/sillytavern-css-compatibility.js'
import { createRoundHistory } from './domain/round-history.js'
import { createRuntimeRecovery } from './domain/runtime-recovery.js'
import { createResourceWorkspaceProjection } from './domain/resource-workspace-projection.js'
import { createFullPromptTemplateCommitter } from './domain/full-prompt-template-commit.js'
import { createFullTemplateRequestProcessor } from './domain/full-prompt-template-request.js'
import { createFullPromptTemplateExecutor } from './domain/full-prompt-template-executor.js'
import { TavernPromptTemplateRuntime } from './domain/tavern-prompt-template-runtime.js'
import {
  preserveRuntimeSource,
  projectAgentContent,
  projectAgentMessageText,
  projectRuntimeReply,
  createRuntimeDisplayProjector,
  projectRuntimeReplyHistory,
  resolveRuntimeMacroText,
  sanitizeAgentProjectionText
} from './domain/runtime-content-projection.js'
import {seededTavernRandom} from './domain/tavern-macro-engine.js'
import { createScriptContinuity } from './domain/script-continuity.js'
import { scriptChunkLayout } from './domain/script-chunks.js'
import { createScriptNavigation } from './domain/script-navigation.js'
import {consumeTemplateInput,templateInputView,persistTemplateInputView,rememberTemplateInputScopes} from './domain/full-prompt-template-input.js'
import {renderLightTemplateRequest} from './domain/light-template-request.js'
import {replaceTavernHelperVariables} from './domain/tavern-helper-context.js'
import { filterSkillMessages, ensureWritingSkillStatus } from './domain/skill-visibility.js'
import { createStoryTimeline } from './domain/story-timeline.js'
import { RETAINED_ROUNDS_WINDOW_SHARE, createStoryCompactionRequest, nativelyRetainedRounds, retainRecentStoryRounds, storyHistoryFullyRetained, usesStoryCompaction } from './domain/story-compaction.js'
import { resolveTavernDataRoot } from './domain/tavern-data.js'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import { createTavernSkillProvider } from './domain/tavern-skill-provider.js'
import { createTavernSkillModule, compatibilityWritingMessages } from './domain/tavern-skills.js'
import { createTavernConversationRegistry } from './domain/tavern-conversation-registry.js'
import { applyTavernRegexText } from './domain/tavern-regex-display.js'
import { installTavernTokenMeter } from './domain/tavern-token-meter.js'
import { createTavernCompactionCoordinator } from './domain/tavern-compaction.js'
import { cordisToolNames, createTurnOrchestrator, dshFileToolNames } from './domain/turn-orchestration.js'
import { resourceWorkspaceContext } from './domain/workspace-resources.js'
import { createWorldBookLibrary } from './domain/worldbook-library.js'
import {createPrivateWorldbookPublication,publicationDocument,publicationCharacterBook} from './domain/private-worldbook-publication.js'
import { constantWorldBookContext, mvuUpdateRulesFromWorldBook, prepareWorldBookRecall, projectWorldBookTemplates } from './domain/worldbook-recall.js'
import { assertWorldBookPatchFields } from './domain/worldbook-resource.js'
import {
  createBackgroundTaskCoordinator,
  isOpeningAwaitingSettlement
} from './domain/background-task-coordinator.js'
import { createProfileDataStore } from './profile-data-store.js'
import { createChatPersistence } from './domain/chat-persistence.js'
import {createVersionedJsonCache} from './domain/versioned-json-cache.js'
import {mutableJsonDraft} from './domain/json-draft.js'
import {createDependencyProjectionCache} from './domain/dependency-projection-cache.js'
import {createSessionViewTransport} from './domain/session-view-transport.js'
import { createChatRecordsStore } from './domain/chat-records-store.js'
import {jsonHttpResponse} from './domain/json-http-response.js'
import {createMaintenanceGate} from './domain/maintenance-gate.js'
import {createRetentionScheduler} from './domain/retention-scheduler.js'
import {createVerifiedBackups} from './domain/verified-backups.js'
import {createProfileRetention} from './domain/profile-retention.js'
import {scopedSessionSignals} from './domain/session-signal-scope.js'
import {createRetentionService,readRetentionPolicy} from './domain/retention-policy.js'
import { createResourceGraph } from './domain/resource-graph.js'
import { createCardOrganization } from './domain/card-organization.js'
import { normalizeBackgroundTasks, applyTavernSettingsPatch, presentTavernSettings, resolveSystemPrompt } from './domain/tavern-settings.js'
import { createBackgroundGenerationPolicy, helperGenerationScope, originalSpForegroundGenerationScope } from './domain/background-generation-policy.js'
// Runtime reads go through runtimePrompt() so panel overrides apply; the raw
// file catalog only supplies built-in defaults. (upstream e2627511)
import { prompt as promptFile, SYSTEM_PROMPT_DEFINITIONS, SYSTEM_PROMPT_NAMES } from './prompt-catalog.js'

// dsh-tavern 宿主插件（profile 组合行）
// RPC：同源 HTTP 路由 /api/dsh-tavern/<method>（客户端 fetch 调用）
// DSH 生命周期负责回合状态；模型工具只处理按需读取和明确修改。
export async function apply(ctx) {
  ctx.effect(() => ctx.get('commands').register(createPresetCommand({ dispatch: dispatchMethod })), 'tavern /preset')
  try {
    const restoreSubprocess=await installHostSubprocessPatch({persistence:ctx.get('sessionPersistence')})
    ctx.effect(()=>restoreSubprocess)
  } catch(error) { console.warn('dsh-tavern: Windows 后台窗口补丁未安装：'+error.message) }

  await clearLegacyTavernDefault(ctx.get('settings'))
  const llm = ctx.get('llm')
  const agentRegistry = ctx.get('agents')
  let toolRestrictions
  const sessionStore = ctx.get('sessions')
  ctx.effect(() => installTavernTokenMeter(ctx.get('tokenMeter')))
  if (llm === undefined || agentRegistry === undefined || sessionStore === undefined) {
    console.error('dsh-tavern: 缺少 llm、agents 或 sessions 服务')
    return
  }
  const agentDefaultModel = ctx.get('agentDefaultModel')
  let autoCompaction = null
  let runtimeRecovery = null
  const compactionTimers = new Map()
  const compactionAbort = new AbortController()
  const sessionSignals = createSessionSignalTransport()
  function queueAutoCompaction(sessionId) {
    if (!autoCompaction || compactionAbort.signal.aborted || compactionTimers.has(sessionId)) return
    const timer = setTimeout(async () => {
      compactionTimers.delete(sessionId)
      const agent = agentRegistry.get(sessionId)
      if (!agent || agent.phase?.kind === 'running' || historyOperations.isRunning(sessionId)) return
      try { await autoCompaction.run(sessionId, { agent, signal: compactionAbort.signal }) }
      catch (error) { if (!compactionAbort.signal.aborted) console.warn('dsh-tavern: 自动压缩暂未执行:', str(error.message || error)) }
    }, 50)
    timer.unref?.(); compactionTimers.set(sessionId, timer)
  }
  ctx.effect(() => () => { compactionAbort.abort(); for (const timer of compactionTimers.values()) clearTimeout(timer) })
	const tavernScriptDispatch = createTavernScriptDispatch({
    publishSignal: function (sessionId, signal) { sessionSignals.publish(sessionId, signal) },
    onDrainLost:(sessionId,details)=>{void mvuDiagnostics.record(sessionId,{stage:"sp-drain-lost",...details}).catch(error=>console.warn("SP 保存失联诊断写入失败",error))}
  })
  let tavernPromptTemplateRuntime
  async function promptTemplateRuntime() {
    tavernPromptTemplateRuntime ??= TavernPromptTemplateRuntime.create()
    return await tavernPromptTemplateRuntime
  }
  const sourceRoot = fileURLToPath(new URL('../../', import.meta.url))
  const dataRoot = resolveTavernDataRoot()
  const stablePrefixStorage = createSessionStablePrefixStorage(dataRoot + '/session-prefixes')
  const maintenanceGate=createMaintenanceGate(),dataStore=createProfileDataStore({dataRoot})
  const capacityLimits=await readCapacitySettings(dataStore)
  const retentionLimits={...await readRetentionPolicy(dataStore),remoteBytes:capacityLimits.storage.remoteBytes,diagnosticBytes:capacityLimits.storage.diagnosticBytes}
  const profileData={...dataStore,retention:retentionLimits,...Object.fromEntries(['writeJson','updateJson','remove'].map(method=>[method,(...args)=>maintenanceGate.mutate(()=>dataStore[method](...args))]))}
  const verifiedBackups=createVerifiedBackups({dataRoot,store:profileData,maximum:retentionLimits.recoveryVersions})
  const oneTimeApprovals = createOneTimeApprovals({store:profileData})
  const userPreferenceProfile = createUserPreferenceProfile({ store: profileData,
    authorizeConfirmation: (input, operation) => oneTimeApprovals.consume(input.approvalToken,
      {sessionId:input.sessionId || 'profile-library',action:'profile-confirm',target:input.profileId,revision:input.draftRevision},operation)
  })
  const sceneWorldbooks = TAVERN_RELEASE_CAPABILITIES.sceneImages ? createSceneWorldbooks({ store: profileData }) : null
  const imageHostDiagnostic = createSceneImageHostLogger(ctx.logger)
  const sceneDiagnostics = TAVERN_RELEASE_CAPABILITIES.sceneImages ? createSceneImageDiagnostics(profileData, { onDiagnostic: imageHostDiagnostic }) : null
  async function captureSceneWorldbook(chat, card, preparedBook) {
    if (sceneWorldbooks === null || (await profileData.readReadonly('scene-images/settings.json'))?.enabled!==true) return null
    try {
      const worldBook = preparedBook === undefined ? await worldBooks.bound(chat.cardPath, card, chat) : preparedBook
      return await sceneWorldbooks.capture({ worldBook, chat, card })
    } catch (_error) {
      console.warn('dsh-tavern: 场景世界书快照保存失败，正文继续；不会用后来的世界书补历史。')
      return null
    }
  }
  const tavernExtensionSettings = createTavernExtensionSettings(profileData, { templateRuntime: promptTemplateRuntime })
  const mvuDiagnostics = createMvuDiagnosticStore(profileData)
  const runtimeNotices = createRuntimeNotices({
    publish: (sessionId, signal) => sessionSignals.publish(sessionId, signal),
    record: (sessionId, notice) => mvuDiagnostics.record(sessionId, { stage: 'session-event', diagnostic: { level: 'error', ...notice } })
  })
  ctx.effect(() => () => runtimeNotices.dispose())
  const profileSessionAccess = createProfileSessionAccess({ forSession: chatForSessionReadonly, readChat: readChatReadonly, readIndex })
  const apiDiagnostics = createTavernApiDiagnostics(profileData)
  const displayDiagnostics = createDisplayDiagnostics()
  const compatibilityDiagnostics = createTavernCompatibilityDiagnosticStore(profileData)
  const remoteCacheBudget=createRemoteCacheBudget({maxBytes:retentionLimits.remoteBytes})
  const tavernRemoteAssets = createTavernRemoteAssetPinStore({
    budget: remoteCacheBudget,
    onDiagnostic: row => performanceDiagnostics.opening(row),
    readJson: async function (path) { return await profileData.readJson(path) },
    updateJson: async function (path, updater) { return await profileData.updateJson(path, updater) }
  })
  const remoteRefreshJobs=new Map()
  ctx.effect(()=>()=>{for(const job of remoteRefreshJobs.values())job.controller.abort();remoteRefreshJobs.clear()})
  const tavernStaticResources = createTavernStaticResourceCache({ budget: remoteCacheBudget, rootDir: dataRoot + '/cache/static-assets' })
  if (!outboundDisabled()) void tavernStaticResources.warm(SILLYTAVERN_CSS_COMPAT_URLS).then(function (results) {
    const failures = results.filter(function (result) { return result.status === 'rejected' })
    if (failures.length > 0) console.warn('dsh-tavern: 部分静态运行库暂未缓存，将在使用时重试:', failures.map(function (result) { return str(result.reason && result.reason.message || result.reason) }).join('；'))
  })
  const settingsPath = 'tavern-settings.json'
  const promptTemplateGlobalVariables = createPromptTemplateGlobalVariables(profileData)
  const cardOrganization = createCardOrganization(profileData)
  const readPromptTemplateGlobalVariables = async chat => {
    const variables = await promptTemplateGlobalVariables.read();
    return chat?.mvu?.enabled === true ? {...variables,extra_analysis:tavernScriptDispatch.mvuActivity(chat).mvuExtraAnalysis} : variables;
  }
  const writePromptTemplateGlobalVariables = promptTemplateGlobalVariables.save
  let tavernSettingsDocument = await profileData.readReadonly(settingsPath)
  const tavernSettingsOperations = createSettingsOperationQueue()
  function promptDefaults() {
    return Object.fromEntries(SYSTEM_PROMPT_NAMES.map(function (name) { return [name, promptFile(name)] }))
  }
  async function readTavernSettings() {
    return tavernSettingsOperations.run(async () => {
      tavernSettingsDocument = await profileData.readReadonly(settingsPath)
      return presentTavernSettings(tavernSettingsDocument, promptDefaults())
    })
  }
  async function updateTavernSettings(patch) {
    for (const key of ['defaultForegroundModel','defaultBackgroundModel','defaultWorkbenchModel','backgroundModel']) if (patch?.[key]) await llm.resolveCallConfig(patch[key])
    return tavernSettingsOperations.run(async () => {
      tavernSettingsDocument = await profileData.updateJson(settingsPath, function (current) {
        return applyTavernSettingsPatch(current, patch)
      })
      return presentTavernSettings(tavernSettingsDocument, promptDefaults())
    })
  }
  function runtimePrompt(name) {
    if (name === 'system-append' && tavernSettingsDocument?.systemAppendEnabled !== true) return ''
    return resolveSystemPrompt(tavernSettingsDocument, name, promptFile)
  }
  function presentSystemPrompts(settings) {
    const byName = Object.fromEntries((settings.systemPrompts || []).map(function (item) { return [item.name, item] }))
    return {
      spec: 'dsh-tavern.system-prompts',
      version: 1,
      systemAppendEnabled: settings.systemAppendEnabled === true,
      prompts: SYSTEM_PROMPT_DEFINITIONS.map(function (definition) {
        return Object.assign({}, definition, byName[definition.name] || { text: promptFile(definition.name), customized: false })
      })
    }
  }
  function importSystemPromptDocument(payload) {
    const prepared = prepareTextImport(payload, '系统提示词文件为空')
    let document
    try { document = JSON.parse(prepared.text) } catch (error) { throw new Error('系统提示词 JSON 无效: ' + str(error && error.message || error)) }
    if (!document || document.spec !== 'dsh-tavern.system-prompts') throw new Error('不是 DSH Tavern 系统提示词文件')
    if (Number(document.version) !== 1) throw new Error('不支持的系统提示词版本: ' + String(document.version))
    const source = document.prompts && typeof document.prompts === 'object' && !Array.isArray(document.prompts) ? document.prompts : {}
    const values = {}
    for (const name of SYSTEM_PROMPT_NAMES) {
      if (name === 'system-append' && source[name] === undefined) continue
      if (typeof source[name] !== 'string' || (source[name].trim() === '' && name !== 'system-append' && name !== 'card-system')) throw new Error('系统提示词文件缺少有效内容: ' + name)
      values[name] = source[name]
    }
    return values
  }
  const applicationUpdater = createApplicationUpdater({
    dataRoot,
    sourceRoot,
    hostDependencyAnchor: fileURLToPath(import.meta.url),
  })
  const responseTestSessions=new Set()
  const modelRequestLog = createModelRequestLog({
    maxRecords:retentionLimits.modelRequests,maxBytes:retentionLimits.modelRequestBytes,
    capture:input=>responseTestSessions.has(input.chat.sessionId),
    enabled: () => process.env.DSH_TAVERN_MODEL_REQUEST_LOG === '1',
    remove: file => profileData.remove(file),
    readJson: async function (path) { return await profileData.readJson(path) },
    writeJson: async function (path, value) { return await profileData.writeJson(path, value) },
    updateJson: async function (path, updater) { return await profileData.updateJson(path, updater) }
  })
  const tavernSkills = createTavernSkillModule({
    directory: dataRoot + '/skills',
    builtInDirectory: sourceRoot + '/presets/tavern/skills'
  })

  let invalidateSkills=()=>{}
  const skillRegistry=ctx.get('skills')
  if(!skillRegistry)throw Error('dsh-tavern: 缺少 skills 服务')
  let filesystemSkills
  skillRegistry.registerProvider(control=>{
    invalidateSkills=control.invalidate
    filesystemSkills=new FileSystemSkillProvider(ctx,control,{includeDefaultRoots:false,customSkillDirs:[dataRoot+'/skills'],bundledSkillDir:sourceRoot+'/presets/tavern/skills'})
    return createTavernSkillProvider({providers:[filesystemSkills],library:tavernSkills,
      roleFor:async agent=>{const chat=await chatForSessionReadonly(agent?.session?.id);return chat ? (chat.mode==='card'?'card':['story','script'].includes(chat.mode||'story')?'foreground':null) : null},
      enabledFor:async (skill,agent)=>{const chat=await chatForSessionReadonly(agent?.session?.id);return chat?.mode==='card'||Array.isArray(chat?.disabledWritingSkills)&&!chat.disabledWritingSkills.includes(skill.name)}
    })
  })
  ctx.effect(()=>tavernSkills.subscribe(invalidateSkills))
  ctx.effect(function*(){yield ()=>filesystemSkills.dispose()},'tavern skill watcher')
  ctx.on('fs/observed',(target)=>filesystemSkills.observeHostMutation(target.displayPath))
  async function writingSkillsFor(chat){return (await tavernSkills.list()).filter(skill=>skill.purpose==='writing').map(skill=>({name:skill.name,description:skill.description,enabled:Array.isArray(chat?.disabledWritingSkills)&&!chat.disabledWritingSkills.includes(skill.name)}))}

  // ---------- profile 私有 preset ----------
  // rc.6 启动器会固定系统 roots，因此在独立 Tavern 进程内追加 profile 自带目录。
  // 不写入全局 `.agent-presets`，避免 Tavern 出现在普通 Web profile 的模式列表。
  const agentPresetsProxy = ctx.get('agentPresets')
  if (agentPresetsProxy === undefined) throw new Error('dsh-tavern: 缺少 agentPresets 服务')
  const agentPresets = agentPresetsProxy[Symbol.for('cordis.original')] || agentPresetsProxy
  const presetSourceDir = fileURLToPath(new URL('../../presets/', import.meta.url))
  if (!agentPresets.resolvedRoots.some(function (root) { return root.path === presetSourceDir })) {
    agentPresets.resolvedRoots.unshift({ path: presetSourceDir, trust: 'user' })
  }

  // ---------- 基础工具 ----------
  function uid(prefix) {
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
  }
  const runtimeGeneration = uid('runtime')
  let coordinationEvents = null
  function str(v) {
    return typeof v === 'string' ? v : (v === undefined || v === null ? '' : String(v))
  }
  function clampInt(v, min, max, def) {
    return Number.isInteger(v) && v >= min && v <= max ? v : def
  }
  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms) })
  }
  async function readJson(rel) {
    return await profileData.readJson(rel)
  }
  async function writeJson(rel, value) {
    await profileData.writeJson(rel, value)
  }
  const CARD_PROJECTION_REVISIONS = 'card-projection-revisions.json'
  async function cardProjectionRevision(cardPath) {
    const state = await readJson(CARD_PROJECTION_REVISIONS)
    return Math.max(0, Number(state && state.cards && state.cards[str(cardPath)]) || 0)
  }
  async function bumpCardProjectionRevision(cardPath) {
    const normalized = normalizeResourcePath(cardPath, 'card')
    const saved = await profileData.updateJson(CARD_PROJECTION_REVISIONS, function (value) {
      const state = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
      const cards = state.cards && typeof state.cards === 'object' && !Array.isArray(state.cards) ? state.cards : {}
      const version = Math.max(0, Number(state.version) || 0) + 1
      return { version, cards: Object.assign({}, cards, { [normalized]: version }) }
    })
    void coordinationEvents?.publishAll()
    return saved
  }
  function groupOfMode(mode) {
    const m = mode || 'story'
    return m === 'story' || m === 'script' ? 'play' : 'card'
  }
  function renderCardText(text, card, macroState = {},options={}) {
    const result = projectAgentContent(text, {
      charName: str(card && card.name),
      macroState,...options
    })
    macroState.userName = result.macroState.userName
    macroState.local = result.macroState.local
    macroState.global = result.macroState.global
    return result.renderedText
  }

  const settlementJobs = new Map()
  const scriptContinuity = createScriptContinuity()
  const performanceDiagnostics = createPerformanceDiagnostics()
  const storyTimeline = createStoryTimeline({ id: uid, now: Date.now })
  const cardPreparation = createCardPreparation({ id: function () { return uid('card') }, now: Date.now })

  // ---------- 模型调用 ----------
  function modelSelection(sessionId) {
    // 会话级选择优先：与官方 api-proxy 相同的读取路径
    if (typeof sessionId === 'string' && sessionId !== '') {
      try {
        const agents = ctx.get('agents')
        const agent = agents !== undefined ? agents.get(sessionId) : undefined
        if (agent !== undefined && agent.session !== undefined && typeof agent.session.requestHeader === 'function') {
          const projected=ctx.get('sessionProjections')?.stateOf(agent.session,'modelSelection');
          const cfg = projected?.pending || agent.session.requestHeader()?.config
          if (cfg !== undefined && typeof cfg.provider === 'string' && typeof cfg.model === 'string') {
            return { provider: cfg.provider, model: cfg.model, ...(cfg.reasoningEffort === undefined ? {} : { reasoningEffort: cfg.reasoningEffort }) }
          }
        }
      } catch (err) {
        console.error('dsh-tavern: 读取会话模型失败', err)
      }
    }
    if (agentDefaultModel !== undefined) {
      try {
        const sel = agentDefaultModel.currentSelection()
        if (sel !== null && typeof sel === 'object' && typeof sel.provider === 'string' && typeof sel.model === 'string') {
          return { provider: sel.provider, model: sel.model }
        }
      } catch (err) {
        console.error('dsh-tavern: 读取默认模型失败', err)
      }
    }
    return null
  }
  async function backgroundModelSelection(chat) {
    const configured = configuredChatBackgroundModel(chat, tavernSettingsDocument)
    if (configured) return configured
    const foreground = await foregroundModels.effectiveSelection(chat, () => readForegroundModelSelection({
      sessionId:chat.sessionId,session:sessionStore.get(chat.sessionId)||agentRegistry.get(chat.sessionId)?.session,
      persistence:ctx.get('sessionPersistence'),sessions:sessionStore,projections:ctx.get('sessionProjections'),fallback:()=>modelSelection(chat.sessionId)
    }))
    return resolveChatBackgroundModel(chat, foreground, tavernSettingsDocument)
  }
  async function tavernModelCatalog() {
    const providers = llm.listProviders()
    const groups = await Promise.all(providers.map(async function (provider) {
      try {
        const models = await llm.listModels(provider.id)
        return {
          provider: provider.id,
          providerName: provider.name || provider.id,
          models: models.filter(function (model) {
            return !Array.isArray(model.inputModalities) || model.inputModalities.includes('text')
          }).map(function (model) { return { id: model.id, name: model.name || model.id } })
        }
      } catch (error) {
        console.warn('dsh-tavern: 读取后台模型目录失败:', provider.id, error)
        return { provider: provider.id, providerName: provider.name || provider.id, models: [] }
      }
    }))
    return groups.filter(function (group) { return group.models.length > 0 })
  }
  async function callModel(opts) {
    assertOutboundEnabled()
    const sel = opts.modelSelection || modelSelection(opts.sessionId)
    if (sel === null) throw new Error('没有可用的模型配置，请先在当前会话的模型选择器中选择模型')
    if (needsHelperWireOptions(opts)) {
      const api=opts.customApi||{},dependencies={llm,settings:ctx.get('settings'),credentials:ctx.get('credentials')};
      const wire=await configuredPresetWire(sel,{},dependencies);
      if(wire || opts.jsonSchema || opts.toolChoice&&!['auto','none'].includes(opts.toolChoice) || unsupportedPresetSampling(api).length || ['custom_include_body','custom_exclude_body','custom_include_headers'].some(key=>api[key]!==undefined)) return callConfiguredHelperApi(opts,sel,dependencies);
    }
    const helperTools = nativeHelperTools(opts.tools)
    const cfg = { provider: sel.provider, model: sel.model }
    if (sel.reasoningEffort !== undefined) cfg.reasoningEffort = sel.reasoningEffort
    // Codex Responses API 不接受 temperature；其他模型仍保留候选温度阶梯。
    if (typeof opts.temperature === 'number' && sel.provider !== 'openai-codex') cfg.temperature = opts.temperature
    if (typeof opts.maxTokens === 'number') cfg.maxTokens = opts.maxTokens
    const prepared = await llm.prepareCall(cfg)
    const messages = nativeHelperMessages([...(opts.system ? [{ role: 'system', content: [{ type: 'text', text: opts.system }] }] : []), ...await admitHelperImages(opts.messages, ctx.get('attachments'), { signal: opts.signal,...opts.networkPolicy })])
    const options = Object.assign({}, prepared.config, { messages, ...(helperTools && opts.toolChoice !== 'none' ? { tools: helperTools } : {}), ...(opts.signal ? { signal: opts.signal } : {}) })
    opts.signal?.throwIfAborted()
    let text = ''
    const toolCalls = createHelperToolAccumulator()
    let finish = null
    try {
      for await (const chunk of prepared.stream(options)) {
        opts.signal?.throwIfAborted()
        toolCalls.apply(chunk)
        if (chunk.type === 'text-delta') { text += chunk.text; opts.onDelta?.(chunk.text) }
        else if (chunk.type === 'finish') finish = chunk.reason
      }
    } catch (err) {
      throw new Error('模型流失败: ' + (err && (err.message || err.code) || err))
    }
    if (finish !== null && finish !== undefined && (finish.kind === 'error' || finish.kind === 'aborted')) {
      const f = finish.failure
      throw new Error('模型调用失败: ' + (f !== undefined && f !== null ? (f.message || f.code) : finish.kind))
    }
    if (finish !== null && finish !== undefined && finish.kind === 'max-tokens') {
      throw new Error('模型输出达到 token 上限')
    }
    const generatedTools = toolCalls.result(text)
    if (generatedTools) return generatedTools
    const out = text.trim()
    if (out === '') throw new Error('模型返回为空')
    return out
  }

  // ---------- 角色卡 ----------
  function splitNovelText(source, requestedSize) {
    const target = clampInt(requestedSize, 300, 800, 500)
    const minSize = Math.max(220, Math.floor(target * 0.7))
    const maxSize = Math.min(1000, Math.floor(target * 1.4))
    const text = str(source).replace(/\r\n?/g, '\n').trim()
    if (text === '') return []
    const units = []
    for (const paragraph of text.split(/\n+/).map(function (item) { return item.trim() }).filter(Boolean)) {
      if (paragraph.length <= maxSize) {
        units.push(paragraph)
        continue
      }
      let rest = paragraph
      while (rest.length > maxSize) {
        let cut = -1
        const lower = Math.max(minSize, target - 120)
        const upper = Math.min(rest.length, maxSize)
        for (let i = upper; i >= lower; i--) {
          if ('。！？；…!?;'.includes(rest[i - 1])) { cut = i; break }
        }
        if (cut < 0) cut = Math.min(target, rest.length)
        units.push(rest.slice(0, cut).trim())
        rest = rest.slice(cut).trim()
      }
      if (rest !== '') units.push(rest)
    }
    const packed = []
    let current = ''
    for (const unit of units) {
      if (current !== '' && current.length + 1 + unit.length > maxSize) {
        packed.push(current)
        current = ''
      }
      current = current === '' ? unit : current + '\n' + unit
      if (current.length >= target && current.length >= minSize) {
        packed.push(current)
        current = ''
      }
    }
    if (current !== '') {
      if (packed.length > 0 && current.length < Math.floor(minSize / 2) && packed[packed.length - 1].length + 1 + current.length <= maxSize) packed[packed.length - 1] += '\n' + current
      else packed.push(current)
    }
    return packed.map(function (text, index) { return { id: 'chunk-' + String(index + 1).padStart(5, '0'), order: index, text: text } })
  }
  async function readIndex() {
    const idx = await readJson('index.json')
    return (idx !== undefined && typeof idx === 'object') ? idx : { cards: [], chats: [] }
  }
  async function writeIndex(idx) { await writeJson('index.json', idx) }
  const fileResources = createFileResourceStore({ dataRoot,onBackupCompleted:verifiedBackups.remember })
  const resourceWorkspaceProjection = createResourceWorkspaceProjection({ root: dataRoot + '/resources' })
  const mobileCardImport = createMobileCardImport({ runtimeHost: process.env.DSH_TAVERN_RUNTIME_HOST })
  const cardDeletion = createCardDeletion({ resources: fileResources, graph: { remove: (...args) => resourceGraph.remove(...args) } })
  const cardTaskPrompts = Object.freeze({
    edit: 'card-task-edit',
    extract: 'card-task-extract',
    script: 'card-task-script',
    material: 'card-task-script',
    worldbook: 'card-task-worldbook',
    preset: 'card-task-preset',
    'debug-play': 'card-task-debug-play'
  })
  async function readCardWorkspace(cardPath) {
    if (str(cardPath) === '') return undefined
    const normalized = normalizeResourcePath(cardPath, 'card')
    const existing = await fileResources.readCard(normalized)
    if (existing === undefined) return undefined
    if (cardPreparation.isWorkspace(existing)) return existing
    return await fileResources.ensureCardWorkspace(normalized, function (working, payload) {
      return cardPreparation.migrate({ working, payload })
    })
  }
  const cardProjectionCache = createVersionedJsonCache()
  async function readCard(cardPath) {
    const normalized = str(cardPath) === '' ? '' : normalizeResourcePath(cardPath, 'card')
    if (!normalized) return undefined
    return mutableJsonDraft(await cardProjectionCache.read(normalized, () => fileResources.version(normalized), async () => {
      const workspace = await readCardWorkspace(normalized)
      const card = workspace === undefined ? undefined : cardPreparation.project(workspace)
      if (card !== undefined) card.path = normalized
      return card
    }))
  }
  const cardExtensionCache=createVersionedJsonCache()
  async function readCardExtensions(cardPath) {
    if(!str(cardPath))return undefined
    const normalized=normalizeResourcePath(cardPath,'card')
    return mutableJsonDraft(await cardExtensionCache.read(normalized,async()=>JSON.stringify(await Promise.all([fileResources.version(normalized),profileData.version('tavern-extension-settings.json')])),async()=>{
      const workspace=await readCardWorkspace(normalized);if(workspace===undefined)return undefined
      return withGlobalRegexScripts(cardPreparation.present({card:workspace,as:'card-extensions'}),await tavernExtensionSettings.read())
    }))
  }
  async function readScript(scriptOrCardPath) {
    if (str(scriptOrCardPath) === '') return undefined
    let scriptPath = str(scriptOrCardPath)
    if (scriptPath.startsWith('cards/')) scriptPath = await fileResources.scriptForCard(scriptPath)
    if (!scriptPath) return undefined
    const kind = resourceKind(scriptPath)
    if (kind !== 'source' && kind !== 'script') throw new Error('剧本引用必须指向剧本文件')
    const source = await fileResources.readText(normalizeResourcePath(scriptPath, kind))
    if (source === undefined) return undefined
    return { path: scriptPath, title: scriptPath.split('/').pop(), sourceChars: source.length, ...scriptChunkLayout(source) }
  }
  function prepareTextImport(payload, emptyMessage) {
    const source = payload !== null && typeof payload === 'object' ? payload : {}
    const name = str(source.name).trim()
    const isEpub = /\.epub$/i.test(name) || str(source.type).toLowerCase() === 'application/epub+zip'
    let text
    let originalText
    if (isEpub) {
      const encoded = str(source.fileB64).replace(/\s+/g, '')
      if (encoded === '') throw new Error('EPUB 文件内容为空')
      if (!/^[a-z0-9+/]*={0,2}$/i.test(encoded) || encoded.length % 4 !== 0) throw new Error('EPUB 文件编码无效')
      text = extractEpubText(Buffer.from(encoded, 'base64'))
    } else {
      originalText = str(source.text)
      text = originalText
    }
    text = text.replace(/\r\n?/g, '\n').trim()
    if (text === '') throw new Error(emptyMessage)
    return Object.assign({}, source, { name, text, ...(originalText === undefined ? {} : { originalText }) })
  }
  async function importScript(cardPath, payload) {
    const prepared = prepareTextImport(payload, '剧本文件为空')
    const existing = (await listSources()).find(function (source) { return source.title === prepared.name })
    const materialPath = existing ? existing.path : await fileResources.importText('source', prepared)
    await fileResources.bindMaterial(cardPath, materialPath)
    const script = await readScript(cardPath)
    return { path: script.path, title: script.title, sourceChars: script.sourceChars, chunkSize: 500, chunkCount: script.chunks.length, importedAt: Date.now() }
  }
  async function bindScript(cardPath, materialPath) {
    await fileResources.bindMaterial(cardPath, materialPath)
    const script = await readScript(cardPath)
    return { path: script.path, title: script.title, sourceChars: script.sourceChars, chunkSize: 500, chunkCount: script.chunks.length }
  }
  async function deleteScript(cardPath) {
    await fileResources.unbindMaterial(cardPath)
    return { unbound: true }
  }
  // ---------- 剧本（可独立保存，也可与人物卡一对一绑定） ----------
  async function readSource(sourcePath) {
    const normalized = normalizeResourcePath(sourcePath, 'source')
    const source = await fileResources.readText(normalized)
    if (source === undefined) return undefined
    return { path: normalized, title: normalized.split('/').pop(), sourceChars: source.length, ...scriptChunkLayout(source) }
  }
  async function listSources() {
    return await Promise.all((await fileResources.list('source')).map(async function (sourcePath) {
      const source = await readSource(sourcePath)
      return { path: sourcePath, title: source.title, sourceChars: source.sourceChars, chunkCount: source.chunks.length }
    }))
  }
  async function importSource(payload) {
    const prepared = prepareTextImport(payload, '剧本文件为空')
    const sourcePath = await fileResources.importText('source', prepared)
    const record = await readSource(sourcePath)
    return { path: sourcePath, title: record.title, sourceChars: record.sourceChars, chunkCount: record.chunks.length, importedAt: Date.now() }
  }
  const migrationSettings = createMigrationSettings(profileData, { originalTemplates: () => extensionRuntime.status()?.installed?.source === 'sillytavern' })
  const scriptAssets = createTavernScriptAssetCache()
  const scriptLibrary = createTavernScriptLibrary({ isBusy:chat=>{try{assertConversationIdle(chat);return false}catch{return true}},resourceVariableDefault:async(scope,chat)=>{const path=scope==='character'?chat.cardPath:scope==='preset'?chat.runtimePresetSnapshot?.presetPath:'';return path?(await resourceIdentities.claim(path)).scriptVariableScope==='shared':false},historyBytes:capacityLimits.storage.historyBytes,store: profileData, chats: { forSession: chatForSession, update: updateChat }, readCardScripts: async chat => (await readCardExtensions(chat.cardPath))?.helperScripts || [] })
  function cardOwnedScripts(scripts) { return scripts.filter(script => script.id !== '__dsh_official_mvu__' && !String(script.id).startsWith('extension-')) }
  async function effectiveHelperScripts(chat) { return [...extensionRuntime.scripts(chat.sessionId),...cardOwnedScripts(resolveTavernScripts(chat, (await readCardExtensions(chat.cardPath))?.helperScripts || []).scripts)] }
  async function isSelectedMvuCore(chat, scriptId) {
    const selection = selectMvuRuntime(await effectiveHelperScripts(chat), { enabled: chat.mvu?.enabled === true })
    return selection?.status === 'selected' && scriptId === (selection.owner === 'official' ? '__dsh_official_mvu__' : selection.scriptId)
  }
  const spTemplates = createSpTemplateLibrary(profileData,{readOnly:()=>extensionRuntime.status().installed?.source==='sillytavern'})
  const spConfigurations = createSpConfigurationLibrary(profileData)
  const spFillBooks = {
      catalog: async chat => { const catalog = await worldBooks.catalog(); return [{ id: '', name: '本局绑定世界书' }, ...catalog.standalone.map(book => ({ id: book.path, name: book.name }))] },
      entries: async (chat, scope) => {
        const sources = Array.isArray(scope) ? scope : ['']
        const result = []
        for (const source of sources) {
          const bound = source ? null : await worldBooks.bound(chat.cardPath,await readChatCard(chat),chat)
          const document = source ? (await worldBooks.getForChat(chat,{ kind: 'standalone', path: source })).document : bound?.document||bound?.view?.raw
          const entries = (Array.isArray(document?.entries) ? document.entries : Object.values(document?.entries || {})).filter(e=>!e.extensions?.dsh_sp_owner||e.extensions.dsh_sp_owner===chat.id)
          for (const [i, e] of entries.entries()) result.push({ id: (source || 'bound') + ':' + (e.uid ?? e.id ?? i), title: e.comment || e.name || '条目 ' + i,
            keys: e.keys || e.key || [], secondaryKeys:e.secondary_keys||e.keysecondary||[],selective:e.selective===true,selectiveLogic:e.selectiveLogic??e.extensions?.selective_logic??0,caseSensitive:e.caseSensitive??e.case_sensitive??e.extensions?.case_sensitive,matchWholeWords:e.matchWholeWords??e.extensions?.match_whole_words,spMirror:!!e.extensions?.dsh_sp_owner,content: e.content || '', enabled: e.enabled !== false && e.disable !== true, constant: e.constant === true, description: e.extensions?.description || '' })
        }
        return result
      }
    }
  const spFillWorldbook=createSpFillWorldbook({chats:{forSession:chatForSession,update:updateChat},worldBooks:new Proxy({},{get:(_,key)=>(...args)=>worldBooks[key](...args)}),readCard:readChatCard,stateOf:databaseState})
  let helperGenerations,spAuthority;
  const extensionRuntime = await createTavernExtensionRuntime({ store:profileData, assertOriginalWrite:()=>{throw Error('此局 SP 由原包唯一写入；宿主仅保存只读缓存。')},assertNativeWrite:async(method,args)=>{const id=typeof args[0]==='string'?args[0]:args[0]?.sessionId||args[0]?.chat?.sessionId;if(id)await spAuthority?.assertNativeWritable(id)}, externalBusy:()=>helperGenerations?.busy('extension-sp-database')===true, createDatabase:()=>createSpDatabase({ sqlLimits:capacityLimits.sql,loadLayer: hash=>spStorage.resolveLayer(hash), chats: { forSession: chatForSession, update: updateChat }, generate: callModel, books:spFillBooks, syncWorldbook:sessionId=>spFillWorldbook.sync(sessionId),
    publish: (sessionId, event) => sessionSignals.publish(sessionId, event) }) })
  const spDatabase=extensionRuntime.database
  const originalSpCatalog=createOriginalSpCatalog({store:profileData,legacy:spTemplates,status:extensionRuntime.status})
  await originalSpCatalog.initialize()
  const assertHelperOwner = createTavernScriptOwnerGuard({ chatForSession:chatForSessionReadonly, scripts: effectiveHelperScripts })
  spAuthority=createSpAuthorityService({chats:{forSession:chatForSessionReadonly,update:updateChat},checkInstalled:sessionId=>extensionRuntime.usesOriginal(sessionId),assertProvider:async(sessionId,request)=>{if(request.scriptId!=='extension-sp-database')throw Error('SP 原包来源无效');await assertHelperOwner(sessionId,request.scriptId,request.expectedLifecycleRevision)},publish:(sessionId,event)=>sessionSignals.publish(sessionId,event)})
  const cardPermissions = createCardPermissions({store:profileData})
  const permissionDenials = createPermissionDenials({onChange:sessionId=>sessionSignals.publish(sessionId,{kind:'tavern-state',version:'permission-denial:'+Date.now()})})
  const frameResources = createFrameResources({
    validateScope: async scope => {
      if (scope.sessionId.startsWith('opening:')) return Boolean(await fileResources.readCard(scope.cardPath))
      const chat = await chatForSession(scope.sessionId)
      return !!chat && chat.cardPath === scope.cardPath && Number(chat.tavernHelperLifecycleRevision || 0) === scope.lifecycleRevision
    },
    readResource: async (url,scope,expected={}) => {
      if (url.pathname === '/api/dsh-tavern/static-assets') {
        const asset=await tavernStaticResources.get(url.searchParams.get('url'),{trustedResource:scope.networkTrusted===true,module:expected.module})
        return {mediaType:cachedResourceMediaType(asset),body:projectCachedResourceBody(asset)}
      }
      if (url.pathname.startsWith('/api/dsh-tavern/remote-assets/')) {
        const asset=await tavernRemoteAssets.readCached(url.pathname.split('/')[4])
        if(!asset)return null
        const source={...asset,body:Buffer.from(asset.content,'utf8')}
        return {mediaType:cachedResourceMediaType(source),body:projectCachedResourceBody(source)}
      }
      if (url.pathname === '/api/dsh-tavern/card-image') {
        const body=await fileResources.readCardImage(scope.cardPath)
        return body?{mediaType:'image/png',body}:null
      }
      if (url.pathname === '/api/dsh-tavern/scene-image' && sceneIllustrations) {
        const image=await sceneIllustrations.readImage(scope.sessionId,Number(url.searchParams.get('turn')),url.searchParams.get('key'),url.searchParams.get('versionId'))
        return image?{mediaType:image.ref.mediaType,body:image.data}:null
      }
      if (url.pathname.startsWith('/api/dsh-tavern/script-images/')) {
        const image=await scriptImages.read('/user/images/unified-statusbar/'+url.pathname.slice('/api/dsh-tavern/script-images/'.length))
        if(image && !(scope.scriptIds || []).includes(image.owner)) throw Object.assign(Error('图片不属于当前卡片脚本'),{status:403})
        return image
      }
      return null
    }
  })
  function cardWorkspaceIdentity(cardPath, workspace) {
    const card=cardPreparation.project(workspace), extensions=cardPreparation.present({card:workspace,as:'card-extensions'})
    return cardExecutableIdentity({cardPath,card,scripts:extensions.helperScripts || [],regexScripts:extensions.regexScripts || []})
  }
  async function cardSecurityIdentity(chat) {
    if (chat.mode === 'card' && str(chat.cardPath) === '') return cardExecutableIdentity({cardPath:''})
    return cardWorkspaceIdentity(chat.cardPath,await readCardWorkspace(chat.cardPath))
  }
  async function scriptPolicy(chat, scriptId) {
    const cardPolicy = await cardPermissions.read({cardPath:chat.cardPath})
    if (scriptId === '__dsh_official_mvu__') return {...cardPolicy, namespaces:['mvu_settings']}
    if (scriptId === '__dsh_message__') return cardPolicy
    const script = (await effectiveHelperScripts(chat)).find(item=>item.id===scriptId)
    const policy=await resourceScriptPolicy(chat,script)
    // An installed server extension already owns this host API. Imported card
    // scripts cannot acquire its reserved identity or installation authority.
    if (extensionRuntime.scripts(chat.sessionId).some(script => script.id === scriptId)) return {...policy,capabilities:[...new Set([...policy.capabilities,'shared-settings','shared-resources','network'])]}
    return policy
  }
  async function resourceScriptPolicy(chat,script) {
    const resourceId=await scriptLibrary.resourceId(chat,script)
    const ownPolicy=await cardPermissions.readResource('script',resourceId)
    const owner=ownPolicy.configured?null:await scriptLibrary.embeddedOwner(chat,script)
    const parentPolicy=owner?.kind==='card'?await cardPermissions.read({cardPath:owner.path}):owner?.kind==='preset'?await cardPermissions.readResource('preset',owner.path):null
    const policy=ownPolicy.configured?ownPolicy:{...mergeScriptPolicies(parentPolicy,ownPolicy),...(parentPolicy?{inheritedFrom:owner.kind+':'+owner.path}:{})}
    return policy
  }
  async function resourcePermissionCatalog(sessionId, {currentOnly=false}={}) {
    const chat=await chatForSession(sessionId), rows=[]
    for(const path of await fileResources.list('card'))if(!currentOnly||path===chat?.cardPath)rows.push({key:'card:'+path,kind:'card',path,name:path,...await cardPermissions.read({cardPath:path})})
    for(const path of await fileResources.list('preset'))if(!currentOnly||path===(chat?.runtimePresetPath||chat?.presetPath||effectiveGamePreset(chat)?.presetPath))rows.push({key:'preset:'+path,kind:'preset',path,name:path,...await cardPermissions.readResource('preset',path)})
    const scripts=await scriptLibrary.get(sessionId)
    for(const [scope,trees] of Object.entries(scripts.library))for(const script of flattenScriptTrees(trees)) {
      const id=await scriptLibrary.resourceId(chat,{...script,scope})
      rows.push({key:'script:'+scope+':'+script.id,kind:'script',scope,scriptId:script.id,name:script.name,...await resourceScriptPolicy(chat,{...script,scope}),id})
    }
    const cardPolicy=chat?await cardPermissions.read(await cardSecurityIdentity(chat)):{}
    const restrictions=projectPermissionDenials(permissionDenials.read(sessionId),{cardPolicy,scripts:rows.filter(row=>row.kind==='script').map(row=>({id:row.scriptId,name:row.name})),scriptPolicies:Object.fromEntries(rows.filter(row=>row.kind==='script').map(row=>[row.scriptId,row]))})
    return {...cardPolicy,resources:rows,restrictions}
  }
  async function changeResourcePermissions(sessionId,targets,capabilities) {
    if(!Array.isArray(targets)||!targets.length||targets.length>2000)throw Error('请选择需要设置的资源')
    const catalog=await resourcePermissionCatalog(sessionId),selected=targets.map(key=>catalog.resources.find(row=>row.key===key))
    if(selected.some(row=>!row))throw Error('资源列表已变化，请刷新后重试')
    const scopes=new Set(selected.filter(row=>row.kind==='script').map(row=>row.scope))
    for(const scope of scopes){const saved=await scriptLibrary.get(sessionId);await scriptLibrary.change(sessionId,{scope,trees:saved.library[scope],expectedLifecycleRevision:saved.lifecycleRevision},saved.revision)}
    const fresh=await resourcePermissionCatalog(sessionId)
    for(const row of selected){const current=fresh.resources.find(item=>item.key===row.key)
      if(row.kind==='card'){const identity=await cardSecurityIdentity({cardPath:row.path});await cardPermissions.change(identity,identity.digest,capabilities)}
      else await cardPermissions.changeResource(row.kind,row.kind==='script'?current.id:row.path,capabilities)
    }
    frameResources.revokeAll()
    for(const id of new Set([sessionId,...(await readIndex()).chats.map(chat=>chat.sessionId)]))if(id)sessionSignals.publish(id,{kind:'tavern-state',version:'resource-permissions:'+Date.now()})
    return resourcePermissionCatalog(sessionId)
  }
  const helperChatFiles=createTavernChatFiles({assertOwner:assertHelperOwner,canReadOtherCards:async(chat,id)=>(await scriptPolicy(chat,id)).capabilities.includes('cross-card'),chats:{read:readChatReadonly,list:async()=>(await readIndex()).chats.map(c=>c.id)},readDatabase:async sessionId=>{if(!extensionRuntime.installed())throw new Error('SP·数据库未安装');return databaseState(await chatForSessionReadonly(sessionId))},save:params=>helperChatTransfer.save(params),open:params=>helperChatTransfer.open(params)})
  const scriptImages=createTavernScriptImages({store:profileData,assertOwner:assertHelperOwner,limits:capacityLimits.images})
  const helperAudio = createTavernHelperAudio({store:profileData,chats:{forSession:chatForSession,update:updateChat},assertOwner:assertHelperOwner,limits:capacityLimits.audio})
  const scriptServices = createTavernScriptServices({ fileLimits:capacityLimits.files,assertOwner: assertHelperOwner, database: spDatabase, store: profileData, chats: { forSession: chatForSession } })
  function configuredModelOrigins() {
    const origins = []
    for (const descriptor of llm.listConfigurableProviders()) {
      let profile = ctx.get('settings')?.get(descriptor.settingsNs)
      for (const key of descriptor.settingsPath || []) profile = profile?.[key]
      if (typeof profile?.baseURL === 'string') { try { origins.push(new URL(profile.baseURL).origin) } catch {} }
    }
    return origins
  }
  const backgroundGeneration = createBackgroundGenerationPolicy({readChat:chatForSessionReadonly,updateChat,settings:readTavernSettings,notify:async(sessionId,scriptId,message)=>{await mvuDiagnostics.record(sessionId,{stage:'script-runtime',diagnostic:{level:'warn',scriptId,message}});sessionSignals.publish(sessionId,{kind:'tavern-state',version:'background-generation-paused:'+Date.now()})}})
  helperGenerations = createHelperGenerationService({scope:async(sessionId,{scriptId,background,anchor}={})=>{
    const chat=await chatForSessionReadonly(sessionId)
    return scriptId==='extension-sp-database'&&background===false&&extensionRuntime.usesOriginal(sessionId)
      ? {...originalSpForegroundGenerationScope(chat,anchor),originalPackageDigest:extensionRuntime.status().installed.digest}
      : helperGenerationScope(chat)
  },admitBackground:backgroundGeneration.admit,networkPolicy:async(sessionId,id)=>({trustedResource:(await scriptPolicy(await chatForSessionReadonly(sessionId),id)).capabilities.includes('network')}),store: profileData, allowedModelOrigins: configuredModelOrigins, assertOwner: assertHelperOwner, callModel, selection: modelSelection, context: async (sessionId,config,scriptId,lifecycleRevision) => {
    const chat = await chatForSession(sessionId); if (!chat) throw new Error('找不到当前游戏')
    const card = await readChatCard(chat), worldBook=await worldBooks.bound(chat.cardPath,card,chat), scriptPrompts=structuredClone(chat.tavernScriptPrompts||[]);
    const scan=[String(config?.user_input||''),scriptPromptScanText(chat,capacityLimits.prompts),...(config?.max_chat_history===0?[]:config?.max_chat_history==='all'||config?.max_chat_history===undefined?chat.messages:chat.messages.slice(-Number(config.max_chat_history))).map(m=>m.text||'')].join('\n');
    const constant=constantWorldBookContext({worldBook}),recalled=prepareWorldBookRecall({chat:{...chat,worldBookReads:{}},worldBook,latestBody:scan,turn:chat.turn||1,limit:(await readTavernSettings()).worldBookRecallLimit});
    const refs=new Set([...constant.refs,...recalled.refs]),entries=(worldBook?.view.entries||[]).filter(e=>refs.has(e.ref));
    return { promptLimits:capacityLimits.prompts,history: projectTavernHelperContext({ ...chat, messages: openingCommandHistory(chat.messages) }).messages.map(m => ({ role: m.role, text: m.message })), preset: effectiveGamePreset(chat),scriptPrompts,
      consumePrompts:async()=>{const once=scriptPrompts.filter(p=>p.once);if(!once.length)return;await assertHelperOwner(sessionId,scriptId,lifecycleRevision);await updateChat(chat.id,current=>{if(Number(current.tavernHelperLifecycleRevision||0)!==Number(lifecycleRevision))throw Error('聊天已变化');current.tavernScriptPrompts=(current.tavernScriptPrompts||[]).filter(p=>!once.some(old=>old.id===p.id&&JSON.stringify(old)===JSON.stringify(p)));return current},{source:'helper-generation.consume-prompts'})},
      prompts: {
      persona_description: chat.tavernPersona?.description || '',char_description: card?.description || '', char_personality: card?.personality || '', scenario: card?.scenario || '', dialogue_examples: card?.mes_example || '',
      world_info_before: entries.filter(e => Number(e.position) === 0).map(e => e.content).join('\n'), world_info_after: entries.filter(e => Number(e.position) !== 0).map(e => e.content).join('\n') } }
  } })
  ctx.effect(() => () => helperGenerations.dispose(), 'dsh-tavern: helper generations')
  const spPostCommitJobs = new Map()
  const spPostCommitControls = new Map()
  const spCompanion = createSpCompanion({ database: spDatabase, chats: { forSession: chatForSession }, generate: callModel, store: profileData, dataRoot })
  const spAdvanced = createSpAdvanced({ sqlLimits:capacityLimits.sql,database: spDatabase, chats: { forSession: chatForSession }, generate: callModel, store: profileData, selection: modelSelection,
    books: spFillBooks })
  const presetLibrary = createPresetLibrary({ resources: fileResources, state: profileData, prepareImport: prepareTextImport,
    decorateSnapshot: async (preset,{omitScriptLibraryDecoration=false}={}) => {
      const migrated=await migrationSettings.snapshot(preset)
      return omitScriptLibraryDecoration?migrated:scriptLibrary.snapshot(migrated)
    } })
  const { read: readPreset, readDocument: readPresetDocument, preview: previewPreset,
    import: importPreset, editor: presetEditor, runtime: runtimePresets, plans: bypassPlans } = presetLibrary
  const playManagement=createPlayManagement({settings:readTavernSettings,validateModel:selection=>llm.resolveCallConfig(selection),store:profileData,chats:{forSession:chatForSession,update:updateChat},presets:presetLibrary,builtinSnapshot:async()=>scriptLibrary.snapshot(await migrationSettings.snapshot(null)),snapshotDatabase:databaseState,readScripts:async chat=>scriptScopeTrees(chat,(await readCardExtensions(chat.cardPath))?.helperScripts||[]),isBusy:chat=>backgroundTasks.activity(chat).busy||Boolean(chat.regenInProgress)||agentRegistry.get(chat.sessionId)?.phase?.kind==='running'})
  const helperPresets=createHelperPresetLibrary({presets:presetLibrary,chats:{forSession:chatForSession,update:updateChat},store:profileData,assertOwner:assertHelperOwner,isBusy:chat=>backgroundTasks.activity(chat).busy||Boolean(chat.regenInProgress)||agentRegistry.get(chat.sessionId)?.phase?.kind==='running'})
  const nativePresets=createNativePresetLibrary({presets:presetLibrary,chats:{forSession:chatForSession},store:profileData,assertOwner:assertHelperOwner,remove:path=>deletePreset(path),isBusy:chat=>backgroundTasks.activity(chat).busy||Boolean(chat.regenInProgress)||agentRegistry.get(chat.sessionId)?.phase?.kind==='running'})
  const izumiConnection=createIzumiConnection({networkPolicy:async(sessionId,id)=>({trustedResource:(await scriptPolicy(await chatForSessionReadonly(sessionId),id)).capabilities.includes('network')}),store:profileData,allowedModelOrigins:configuredModelOrigins,chats:{forSession:chatForSession,update:updateChat},llm,settings:{get:(...args)=>ctx.get('settings')?.get(...args)},credentials:{resolve:(...args)=>ctx.get('credentials')?.resolve(...args)},selection:modelSelection,selectModel:request=>ctx.get('sessionController').selectModel(request),assertOwner:assertHelperOwner,isBusy:chat=>backgroundTasks.activity(chat).busy||Boolean(chat.regenInProgress)||agentRegistry.get(chat.sessionId)?.phase?.kind==='running'})
  let resourceGraph
  const resourceIdentities=createResourceVersionRegistry(profileData)
  const gameResourceBindings=createGameResourceBindings({chats:{forSession:chatForSessionReadonly,update:updateChat},presets:presetLibrary,identities:resourceIdentities,
    resolveScripts:(chat,modes)=>scriptLibrary.follow(chat,modes),
    migrateChat:async chat=>{const books=await worldBooks.migrateChat(chat),variables=await scriptVariablePolicy.migrateChat(chat);return books||variables},
    // A view may arrive while an idle agent's helper event is still executing.
    // Following a new script/preset here would invalidate that event's lifecycle.
    isBusy:chat=>backgroundTasks.activity(chat).busy||Boolean(chat.regenInProgress)||agentRegistry.get(chat.sessionId)?.phase?.kind==='running'||helperEvents.isRunning(chat.sessionId)||tavernScriptDispatch.status(chat.sessionId).busy,
    onChange:chat=>sessionSignals.publish(chat.sessionId,{kind:'tavern-state',version:'resources:'+chat.playConfigRevision})})
  async function renameResource(resourcePath, name) { return await resourceGraph.rename(resourcePath, name) }
  async function deleteLibraryResource(resourcePath, expectedKind) {
    const result = await resourceGraph.remove(resourcePath, expectedKind)
    return { removed: result.path }
  }
  async function deleteResource(resourcePath) { return await deleteLibraryResource(resourcePath, 'source') }
  async function deletePreset(resourcePath) {
    return await deleteLibraryResource(resourcePath, 'preset')
  }
  let helperWorldbooks
  const worldBooks = createWorldBookLibrary({
    identities:resourceIdentities,
    projectMirror:(record,chat)=>projectSpWorldbookMirror(record,chat,databaseState(chat,{readonly:true})),
    resourceVersion:path=>fileResources.version(path),
    additionalSources:chat=>helperWorldbooks?helperWorldbooks.additionalSources(chat):[],
    bindingStamp:chat=>helperWorldbooks?helperWorldbooks.stamp(chat):null,
    normalizePath: fileResources.canonicalPath,
    resources: {
      list: async function (kind) { return await fileResources.list(kind) },
      readText: async function (path) { return await fileResources.readText(path) },
      metadata: async function (path) { return await fileResources.metadata(path) },
      import: async function (prepared, working) { return await fileResources.importWorldBook(prepared, working) },
      write: async function (path, text) { return await fileResources.writeWorking(path, text) },
      bindingForCard: async function (cardPath) { return await fileResources.worldBookBindingForCard(cardPath) },
      bind: async function (cardPath, path) { return await fileResources.bindWorldBook(cardPath, path) },
      bindMany: async function (cardPath, sources) { return await fileResources.bindWorldBooks(cardPath, sources) },
      unbind: async function (cardPath) { return await fileResources.unbindWorldBook(cardPath) }
    },
    cards: {
      listPaths: async function () { return await fileResources.list('card') },
      read: readCard,
      metadata: async function (cardPath) { return await fileResources.metadata(cardPath) },
      update: async function (cardPath, patch) { return await updateCard(cardPath, patch) }
    },
    removeStandalone: async function (path) { return await deleteLibraryResource(path, 'worldbook') }
  })
  const privateWorldbookPublication=createPrivateWorldbookPublication({
    chats:{forSession:chatForSessionReadonly,update:updateChat},worldBooks,store:profileData,backups:verifiedBackups,
    isBusy:chat=>{try{assertConversationIdle(chat);return false}catch{return true}},
    publishPublic:async(source,document,expected,beforeCommit)=>{
      const isCard=source.kind==='card',path=await fileResources.canonicalPath(isCard?source.cardPath:source.path,isCard?'card':'worldbook')
      if(isCard)await readCardWorkspace(path)
      return fileResources.withEditLock(path,async()=>{
        const text=await fileResources.readText(path);if(text===undefined)throw Error('公共来源已不存在，请刷新')
        const saved=JSON.parse(text),actual=isCard?cardPreparation.project(saved).character_book:saved
        if(!isDeepStrictEqual(publicationDocument(actual),expected))throw Error('公共版本已变化，请重新查看差异')
        const next=isCard?cardPreparation.update({kind:'card',card:saved,patch:{character_book:publicationCharacterBook(document,actual)}}).card:document
        await beforeCommit()
        await fileResources.writeWorking(path,JSON.stringify(next,null,2),{expectedText:text})
        if(isCard)await bumpCardProjectionRevision(path)
      })
    }
  })
  function emptyCardWorkspace() {
    return { mountedResources: [], sourcePaths: [], cursor: 0, prepared: null, done: false, player: '', draft: { name: '', description: '', personality: '', scenario: '', first_mes: '', mes_example: '', system_prompt: '', post_history_instructions: '', creator_notes: '', tags: [], alternate_greetings: [] } }
  }
  function normalizeChat(chat) {
    if (chat === undefined || chat === null || typeof chat !== 'object') return chat
    if (chat.mode === 'revision' || chat.mode === 'extract') chat.mode = 'card'
    if (chat.requestMode !== 'sillytavern') chat.requestMode = 'dsh'
    if (typeof chat.cardPath !== 'string') chat.cardPath = ''
    if (chat.macroState === null || typeof chat.macroState !== 'object') chat.macroState = { userName: '你', local: {}, global: {} }
    if (typeof chat.macroState.userName !== 'string' || chat.macroState.userName === '' || chat.macroState.userName === 'User') chat.macroState.userName = '你'
    if (chat.macroState.local === null || typeof chat.macroState.local !== 'object') chat.macroState.local = {}
    if (chat.macroState.global === null || typeof chat.macroState.global !== 'object') chat.macroState.global = {}
    if(chat.macroState.pickSeed!==chat.id)chat.macroState.pickSeed=chat.id
    if (chat.mode === 'card') {
      if (chat.workspace === null || typeof chat.workspace !== 'object') chat.workspace = chat.extract !== null && typeof chat.extract === 'object' ? chat.extract : emptyCardWorkspace()
      if (!Array.isArray(chat.workspace.mountedResources)) chat.workspace.mountedResources = []
      delete chat.extract
      if (chat.cardName === '抽取中') chat.cardName = str(chat.workspace.draft && chat.workspace.draft.name) || '卡片工作台'
    }
    return chat
  }
  const chatJournalStore = createChatRecordsStore({ dataRoot, legacyData: profileData, now: Date.now, logger: console, snapshotLimit:retentionLimits.snapshots,onMetric:performanceDiagnostics.storage, protectedRevisionsUsesChat:false,protectedRevisions: id => chatPersistence.retainedRevisions(id) })
  const spStorage = createSpStorageStore(chatJournalStore, { dataRoot })
  ctx.effect(() => () => { void spStorage.close() }, 'dsh-tavern: close database storage')
  const nativeUpgradeReceipt = await profileData.readJson('native-session-upgrade.json')
  const chatPersistence = createChatPersistence({ store: spStorage, onMetric:performanceDiagnostics.storage, normalize: value => applyNativeSessionUpgrade(normalizeChat(value), nativeUpgradeReceipt), now: Date.now })
  const maintenanceChatIdentity=new Map(),maintenanceChatSessionIds=new Map()
  function noteMaintenanceChat(chat){
    if(!chat)return
    const previous=maintenanceChatIdentity.get(chat.id)
    if(previous&&Number(previous._storageRevision)>Number(chat._storageRevision))return
    if(previous?.sessionId&&previous.sessionId!==chat.sessionId)maintenanceChatSessionIds.delete(previous.sessionId)
    maintenanceChatSessionIds.set(chat.sessionId,chat.id)
    const lifecycleRevision=Number(chat.tavernHelperLifecycleRevision||0),scriptTreeRevision=Number(chat.tavernScriptTreeRevision||0)
    maintenanceChatIdentity.set(chat.id,{id:chat.id,sessionId:chat.sessionId,_storageRevision:chat._storageRevision,lifecycleRevision,scriptTreeRevision,mode:chat.mode||'story',
      ...(previous?.lifecycleRevision===lifecycleRevision&&previous.scriptTreeRevision===scriptTreeRevision&&previous.sessionId===chat.sessionId&&previous.mode===(chat.mode||'story')?{unloadSource:previous.unloadSource}:{}),
      taskMailbox:{tasks:Object.fromEntries(Object.keys(chat.taskMailbox?.tasks||{}).map(id=>[id,true]))},
      timeline:{participants:Object.fromEntries(Object.entries(chat.timeline?.participants||{}).map(([key,value])=>[key,{sessionId:value.sessionId}]))}})
  }
  function forgetMaintenanceChat(chatId){const previous=maintenanceChatIdentity.get(chatId);if(previous)maintenanceChatSessionIds.delete(previous.sessionId);maintenanceChatIdentity.delete(chatId)}
  function originalSpUnloadScope(sessionId){
    const id=maintenanceChatSessionIds.get(sessionId),identity=maintenanceChatIdentity.get(id),scope=identity?.unloadSource;
    if(!scope||deletedChatIds.has(id)||deletingChatIds.has(id)||identity.sessionId!==sessionId||identity.lifecycleRevision!==scope.lifecycleRevision||identity.scriptTreeRevision!==scope.scriptTreeRevision||!['story','script'].includes(identity.mode)||!extensionRuntime.installed()||!extensionRuntime.usesOriginal(sessionId)||extensionRuntime.status().installed?.digest!==scope.packageDigest||extensionRuntime.status().revision!==scope.extensionRevision||!extensionRuntime.scripts(sessionId).some(script=>script.id==='extension-sp-database'))return null;
    return scope;
  }
  function rememberOriginalSpUnloadScope(chat,capturedIdentity,packageDigest,extensionRevision,publishedScripts,extensionScripts,mvuSelection){
    const identity=maintenanceChatIdentity.get(chat.id),original=publishedScripts.filter(script=>script.id==='extension-sp-database'),source=extensionScripts.find(script=>script.id==='extension-sp-database');
    const currentSource=extensionRuntime.scripts(chat.sessionId).find(script=>script.id==='extension-sp-database');
    // use() publishes immutable JSON snapshots, not extension object identity.
    if(!capturedIdentity||!identity||Number(identity._storageRevision)!==Number(chat._storageRevision)||identity.lifecycleRevision!==Number(chat.tavernHelperLifecycleRevision||0)||identity.sessionId!==chat.sessionId||identity.mode!==(chat.mode||'story')||deletedChatIds.has(chat.id)||deletingChatIds.has(chat.id)||!extensionRuntime.installed()||!extensionRuntime.usesOriginal(chat.sessionId)||extensionRuntime.status().installed?.digest!==packageDigest||extensionRuntime.status().revision!==extensionRevision||!source||!currentSource||source.id!==currentSource.id||source.scope!==currentSource.scope||typeof source.content!=='string'||source.content!==currentSource.content||original.length!==1||original[0].scope!=='extension'||! /^[a-f0-9]{64}$/.test(original[0].sourceDigest||''))return;
    if(mvuSelection?.status==='incompatible')return;
    const participants=publishedScripts.map(script=>({scriptId:script.id,sourceDigest:script.sourceDigest}));
    // This is the same official-core projection as scriptsForView, including its
    // exact immutable loader source when the selected core is not in the list.
    if(mvuSelection?.owner==='official'&&mvuSelection.assetUrl)participants.unshift({scriptId:'__dsh_official_mvu__',sourceDigest:'await import(new URL('+JSON.stringify(String(mvuSelection.assetUrl))+', document.baseURI).href);'});
    participants.sort((a,b)=>a.scriptId.localeCompare(b.scriptId));
    if(participants.some(p=>!p.scriptId||!p.sourceDigest)||new Set(participants.map(p=>p.scriptId)).size!==participants.length)return;
    identity.unloadSource={chatId:chat.id,lifecycleRevision:identity.lifecycleRevision,scriptTreeRevision:identity.scriptTreeRevision,scriptId:'extension-sp-database',sourceDigest:original[0].sourceDigest,packageDigest,extensionRevision,participants};
  }
  const frameUnloads=createFrameUnloadCapabilities({dispatch:tavernScriptDispatch,scopeFor:originalSpUnloadScope})
  async function readChat(chatId) {
    const chat = await chatPersistence.read(chatId)
    if(!chat)forgetMaintenanceChat(chatId)
    noteMaintenanceChat(chat)
    if (chat) {
      const runtime=playRuntimeSettings(chat,await readTavernSettings())
      chat.webSearchEnabled=runtime.webSearchEnabled;chat.backgroundTasks=runtime.backgroundTasks;chat.disabledWritingSkills=runtime.disabledWritingSkills
    }
    return chat
  }
  const preferenceViews = new WeakMap()
  async function readChatReadonly(chatId) {
    const chat = await chatPersistence.readReadonly(chatId)
    if(!chat)forgetMaintenanceChat(chatId)
    noteMaintenanceChat(chat)
    if (!chat) return chat
    const runtime=playRuntimeSettings(chat,await readTavernSettings()),cached=preferenceViews.get(chat)
    if(cached?.webSearchEnabled===runtime.webSearchEnabled&&JSON.stringify(cached.backgroundTasks)===JSON.stringify(runtime.backgroundTasks)&&JSON.stringify(cached.disabledWritingSkills)===JSON.stringify(runtime.disabledWritingSkills))return cached
    const view=Object.freeze({...chat,webSearchEnabled:runtime.webSearchEnabled,backgroundTasks:runtime.backgroundTasks,disabledWritingSkills:runtime.disabledWritingSkills});preferenceViews.set(chat,view);return view
  }
  async function chatForSessionReadonly(sessionId) { return conversationRegistry.resolve(sessionId,{readonly:true}) }
  async function readChatRevision(chatId, revision) { return await chatPersistence.readRevision(chatId, revision) }
  async function rawWriteChat(chat, metadata) {
    if (deletedChatIds.has(chat.id)) throw new Error('对话已删除')
    const saved=await chatPersistence.write(chat, metadata);noteMaintenanceChat(saved);return saved
  }
  async function rawUpdateChat(chatId, mutation, metadata) {
    if (deletedChatIds.has(chatId)) throw new Error('对话已删除')
    const saved=await chatPersistence.update(chatId, mutation, metadata);noteMaintenanceChat(saved);return saved
  }
  let conversationRegistry
  async function syncChatSummary(chat) {
    if (!conversationRegistry || chat === undefined) return
    try { await conversationRegistry.sync(chat) }
    catch (error) { console.warn('dsh-tavern: 会话摘要索引同步失败，将在下次启动修复:', str(error && error.message || error)) }
  }
  const deletedChatIds = new Set(),deletingChatIds=new Set()
  async function writeChat(chat, metadata) {
    return maintenanceGate.mutate(()=>writeChatGated(chat,metadata))
  }
  async function writeChatGated(chat, metadata) {
    metadata?.signal?.throwIfAborted()
    if (deletedChatIds.has(chat.id)) throw new Error('对话已删除')
    const saved = await rawWriteChat(chat, metadata)
    metadata?.signal?.throwIfAborted()
    await toolRestrictions?.sync(agentRegistry.get(saved.sessionId), saved)
    await syncChatSummary(saved)
    void coordinationEvents?.publish(saved.sessionId)
    if (!str(metadata?.source).startsWith('compaction.')) queueAutoCompaction(saved.sessionId)
    return saved
  }
  async function updateChat(chatId, mutation, metadata) {
    return maintenanceGate.mutate(()=>updateChatGated(chatId,mutation,metadata))
  }
  async function updateChatGated(chatId, mutation, metadata) {
    metadata?.signal?.throwIfAborted()
    if (deletedChatIds.has(chatId)) throw new Error('对话已删除')
    let changed=false
    const saved = await rawUpdateChat(chatId, async current=>{const result=await mutation(current);changed=result!==undefined;return result}, metadata)
    metadata?.signal?.throwIfAborted()
    if(!changed)return saved
    if (saved) await toolRestrictions?.sync(agentRegistry.get(saved.sessionId), saved)
    await syncChatSummary(saved)
    if (saved !== undefined) {
      void coordinationEvents?.publish(saved.sessionId)
      if (!str(metadata?.source).startsWith('compaction.')) queueAutoCompaction(saved.sessionId)
    }
    return saved
  }
  conversationRegistry = createTavernConversationRegistry({
    store: {
      readLinks: async function () { return await profileData.readReadonly('sessions.json') },
      updateLinks: async function (updater) { return await profileData.updateJson('sessions.json', updater) },
      readIndex,
      writeIndex,
      readChat,
      readChatReadonly,
      writeChat: rawWriteChat,
      removeChat: async function (chatId) { await chatPersistence.remove(chatId) }
    }
  })
  async function readSessionMap() { return await conversationRegistry.links() }
  async function chatForSession(sessionId) { return await conversationRegistry.resolve(sessionId) }
  const historyRecall = createHistoryRecall()
  async function recallHistoryForSession(sessionId, args) {
    const chat = await chatForSession(sessionId)
    if (chat === undefined) throw new Error('当前 Session 没有对应的 Tavern Chat')
    const mode = chat.mode || 'story'
    if (mode !== 'story' && mode !== 'script') throw new Error('历史正文只能在游玩模式中检索')
    return historyRecall.recall(Object.assign({ chat }, args || {}))
  }
  // Upstream 54fd7e1b (foreground only): the story agent looks up the game's bound worldbook,
  // private layer included, instead of inventing settings recall did not inject.
  const searchWorldbook = createWorldbookSearch({
    load: async sessionId => {
      const chat = await chatForSessionReadonly(sessionId)
      if (!chat || !['story', 'script'].includes(chat.mode || 'story')) throw new Error('世界书查询仅用于当前游玩对话')
      const card = await readChatCard(chat)
      return { chat, card, worldBook: await worldBooks.bound(chat.cardPath, card, chat) }
    },
    project: ({ chat, card }, text) => projectAgentContent(text, { charName: card?.name, macroState: chat.macroState, chatId: chat.id }).agentText
  })
  resourceGraph = createResourceGraph({
    cardOrganization,
    permissions: cardPermissions,
    resources: fileResources,
    projectReferences:async operation=>{await resourceIdentities.project(operation);await helperWorldbooks?.projectReferences(operation)},
    presets: runtimePresets,
    chats: { readIndex, writeIndex, readChat, writeChat },
    operations: {
      read: async function () { return await readJson('resource-graph-operation.json') },
      write: async function (operation) { await writeJson('resource-graph-operation.json', operation) },
      remove: async function () { await profileData.remove('resource-graph-operation.json') }
    }
  })
  async function readChatCard(chat) {
    const card = await readCard(chat.cardPath)
    if (card === undefined) throw new Error('人物卡不存在: ' + chat.cardPath)
    return card
  }
  async function importCard(payload, trustResource = false) {
    const workspace = cardPreparation.create({ kind: 'import', payload: payload })
    const cardPath = await fileResources.importCard(payload, workspace)
    const card = cardPreparation.project(workspace)
    const identity=cardWorkspaceIdentity(cardPath,workspace)
    await cardPermissions.change(identity,identity.digest,trustResource?COMPATIBILITY_CAPABILITIES:[])
    return { path: cardPath, name: card.name, description: card.description, tags: card.tags, importWarnings:workspace.meta?.importWarnings || [], variableReview:inspectImportedVariables(workspace,'角色卡') }
  }
  async function listCards() {
    const cardPaths = await fileResources.list('card')
    const scriptBindings = await fileResources.scriptBindingsForCards(cardPaths)
    const cards = await Promise.all(cardPaths.map(async function (cardPath) {
      try {
        const [workspace, hasImage] = await Promise.all([readCardWorkspace(cardPath), fileResources.hasCardImage(cardPath)])
        const card = cardPreparation.project(workspace)
        const scriptPath = scriptBindings[cardPath]
        return {
          path: cardPath,
          name: card.name,
          importedAt: Number(workspace && workspace.meta && workspace.meta.importedAt) || 0,
          hasImage,
          script: scriptPath === undefined ? null : { path: scriptPath, title: scriptPath.split('/').pop() }
        }
      } catch {
        // A broken working file must not hide the remaining library. Keep its
        // identity visible; do not leak parser excerpts or overwrite evidence.
        return {
          path: cardPath, name: cardPath.split('/').pop().replace(/\.[^.]+$/, ''),
          importedAt: 0, hasImage: false, script: null,
          readError: '人物卡无法读取，请检查文件格式或访问权限：' + cardPath
        }
      }
    }))
    return await cardOrganization.project(orderCardsByNewestImport(cards))
  }
  async function resourceBindingProjection() {
    const cards = await listCards()
    return await Promise.all(cards.map(async function (card) {
      return {
        card: { path: card.path, name: card.name },
        script: card.script === null ? null : { path: card.script.path },
        worldbook: await fileResources.worldBookBindingForCard(card.path)
      }
    }))
  }
  async function resourceDiagnosticProjection(chat) {
    const references = Array.isArray(chat && chat.workspace && chat.workspace.mountedResources)
      ? chat.workspace.mountedResources.filter(function (item) { return item && item.kind === 'play-chat' })
      : []
    return await Promise.all(references.map(async function (reference) {
      try {
        const sourceChat = await readChat(reference.chatId)
        if (sourceChat === undefined) return { ref: reference.path, chatId: reference.chatId, turn: reference.turn, status: 'missing' }
        const overview = readPlayChatDebugTurn(chat, sourceChat, reference, { turn: reference.turn, layer: 'overview', limit: 6000 })
        return { ref: overview.ref, chatId: overview.chatId, turn: overview.turn, status: 'available', overview: overview.text,
          sourceUpdatedAt: Math.max(0, Number(reference.sourceUpdatedAt) || 0), cardSnapshotVersion: overview.cardSnapshotVersion, cardSnapshotDigest: overview.cardSnapshotDigest }
      } catch (error) {
        return { ref: str(reference && reference.path), chatId: str(reference && reference.chatId), turn: Math.max(0, Number(reference && reference.turn) || 0),
          status: 'unavailable', error: str(error && error.message || error).slice(0, 1000) }
      }
    }))
  }
  async function publishResourceWorkspace(sessionId, chat) {
    if (!chat || (chat.mode || 'story') !== 'card') return null
    return await resourceWorkspaceProjection.publish({
      sessionId,
      context: {
        chatId: str(chat.id), mode: 'card',
        card: str(chat.cardPath) === '' ? null : { path: str(chat.cardPath), name: str(chat.cardName) },
        mountedResources: Array.isArray(chat.workspace && chat.workspace.mountedResources) ? chat.workspace.mountedResources : []
      },
      bindings: await resourceBindingProjection(),
      diagnostics: await resourceDiagnosticProjection(chat)
    })
  }
  const openingPreparation = createOpeningPreparation({ promptLimits:capacityLimits.prompts,readCard, worldBooks, readRuntimeExtensions: async cardPath => tavernRemoteAssets.pinExtensions(await readCardExtensions(cardPath)), templateRuntime: promptTemplateRuntime, fullTemplateEnabled,lightTemplateEnabled, generateRaw: (config, context) => generateHelperRaw(config, { ...context, promptLimits:capacityLimits.prompts,callModel }) })
  ctx.effect(()=>()=>openingPreparation.dispose(), 'tavern opening preparation lifetime')
  async function getCardOpenings(cardPath, userName, requestMode, openingDataVersion) {
    const startedAt = performance.now(), stages = {}
    let success = false
    async function timedStage(stage, operation) {
      const started = performance.now()
      try { return await operation() } finally { stages[stage] = Math.round(performance.now() - started); performanceDiagnostics.opening({ stage, durationMs: stages[stage] }) }
    }
    try {
    const card = await timedStage('readCard', () => readCard(cardPath))
    if (card === undefined) throw new Error('人物卡不存在: ' + cardPath)
    const settings = await readTavernSettings()
    const cardExtensions = await timedStage('readExtensions', () => readCardExtensions(cardPath))
    const extensions = { ...cardExtensions, ...await timedStage('resources', () => tavernRemoteAssets.pinExtensions(cardExtensions)) }
    const preset = settings.compatibilityMode && requestMode === 'sillytavern'
      ? await runtimePresets.fullSnapshot()
      : null
    const previews = await timedStage('preview', () => projectCardOpeningPreviews({
      card,
      extensions,
      userName,
      presetRegexScripts: Array.isArray(preset && preset.regexScripts) ? preset.regexScripts : []
    }))
    const hasOpeningScript = opening => /<script\b/i.test(opening.projection.text) || opening.projection.parts.some(part => /<script\b/i.test(part.content || ''))
    const helperScripts = projectTavernHelperScripts(extensions.helperScripts).scripts
    const hasHelperScripts = helperScripts.length > 0
    const openingAccess=frameResources.publish({sessionId:'opening:'+cardPath,cardPath,lifecycleRevision:0,scriptIds:helperScripts.map(script=>script.id)},JSON.stringify([card,extensions]))
    const interactive = hasHelperScripts || previews.openings.some(hasOpeningScript)
    const preparation = interactive ? await timedStage('prepare', () => openingPreparation.create(cardPath, { card, extensions, runtime: (extensions.mvuResources || []).some(item => item.enabled !== false), userName })) : null
    if (preparation) {
      const choices = cardOpeningChoices(card)
      const swipes = choices.map(opening => opening.text)
      const openingIds = choices.map(opening => opening.id)
      for (const opening of previews.openings) if (hasHelperScripts || hasOpeningScript(opening)) {
        opening.openingPreview = { swipes, openingIds, selectedIndex: openingIds.indexOf(opening.id),assetAccess:openingAccess,
          messageHtml: opening.projection.parts.map(part => part.kind === 'markdown' ? marked.parse(str(part.text), { gfm: true }) : str(part.content)).join('\n'),
          preparationId: preparation.id, worldbook: preparation.worldbook, characterName: card.name, runtime: preparation.runtime }
      }
    }
    success = true
    return compactOpeningResponse({
      preparationId: preparation?.id || '',
      openings: previews.openings,
      diagnostics: previews.diagnostics,
      trustedCardMode: !outboundDisabled() && (await cardPermissions.read(cardExecutableIdentity({cardPath,card,scripts:cardOwnedScripts(helperScripts),regexScripts:extensions.regexScripts || [],preset}))).trustedCardMode
    }, openingDataVersion)
    } finally {
      console.info('[dsh-tavern.opening]', JSON.stringify({ success, durationMs: Math.round(performance.now() - startedAt), stages }))
    }
  }
  function presentUserPreferenceProfile(value) {
    const confirmed = value && value.hasConfirmed && value.confirmed ? value.confirmed : null
    return {
      defaultProfileId: value?.defaultProfileId || '', profileId: value?.profileId, name: value?.name, profiles: value?.profiles || [],
      hasDraft: Boolean(value && value.hasDraft),
      draftRevision: value && value.hasDraft ? Number(value.draft && value.draft.revision) || 0 : 0,
      draft: value?.hasDraft ? value.draft : null,
      hasConfirmed: confirmed !== null,
      confirmedRevision: confirmed === null ? 0 : Number(confirmed.profileRevision) || 0,
      defaultEnabled: confirmed !== null && value.defaultEnabled === true,
      confirmed: confirmed === null ? null : {
        summary: str(confirmed.summary),
        injectionText: str(confirmed.injectionText),
        dimensions: Array.isArray(confirmed.dimensions) ? confirmed.dimensions : [],
        rawAnswers: Array.isArray(confirmed.rawAnswers) ? confirmed.rawAnswers : [],
        uncertainties: Array.isArray(confirmed.uncertainties) ? confirmed.uncertainties : [],
        confirmedAt: Number(confirmed.confirmedAt) || 0
      }
    }
  }
  async function listTavernResources() {
    const cards = await listCards()
    const sources = await listSources()
    return {
      cards,
      resources: sources.map(function (source) {
        const boundCards = cards.filter(function (card) { return card.script !== null && card.script.path === source.path }).map(function (card) { return { path: card.path, name: card.name } })
        return { path: source.path, previewPath: fileResources.absolute(source.path), title: source.title, sourceChars: Number(source.sourceChars) || 0, chunkCount: Number(source.chunkCount) || 0, boundCards }
      })
    }
  }
  async function updateCard(cardPath, patch, revision, rawOperations) {
    const workspace = await readCardWorkspace(cardPath)
    if (workspace === undefined) throw new Error('人物卡不存在: ' + cardPath)
    const change = cardPreparation.update({ kind: 'card', card: workspace, patch: patch, revision: revision, rawOperations: rawOperations })
    const savedWorkspace = change.card
    if (!change.changed) {
      const unchangedCard = change.view
      unchangedCard.path = cardPath
      unchangedCard.extensions = cardPreparation.present({ card: savedWorkspace, as: 'card-extensions' })
      return Object.assign({}, change, { card: unchangedCard })
    }
    await fileResources.writeWorking(normalizeResourcePath(cardPath, 'card'), JSON.stringify(savedWorkspace, null, 2))
    await bumpCardProjectionRevision(cardPath)
    const savedCard = change.view
    savedCard.path = cardPath
    savedCard.extensions = cardPreparation.present({ card: savedWorkspace, as: 'card-extensions' })
    await syncCardName(cardPath, savedCard.name)
    return Object.assign({}, change, { card: savedCard })
  }
  const replaceCardText = createCardTextReplacement({
    resources: fileResources, cards: cardPreparation, validate: validateCardText,
    afterSave: async (path, card) => { await bumpCardProjectionRevision(path); await syncCardName(path, card.name) }
  })
  async function replaceCardVariables(cardPath, variables) {
    const workspace = await readCardWorkspace(cardPath)
    if (workspace === undefined) throw new Error('人物卡不存在: ' + cardPath)
    const raw = cardPreparation.present({ card: workspace, as: 'raw' })
    const root = raw && (raw.spec === 'chara_card_v2' || raw.spec === 'chara_card_v3') && raw.data && typeof raw.data === 'object'
      ? '/data/extensions/tavern_helper/variables'
      : '/extensions/tavern_helper/variables'
    await updateCard(cardPath, {}, undefined, [{ op: 'set', path: root, value: variables }])
    return structuredClone(variables)
  }
  async function syncCardName(cardPath, cardName) {
    const idx = await readIndex()
    idx.chats = (idx.chats || []).map(function (item) { return item.cardPath === cardPath ? Object.assign({}, item, { cardName: cardName }) : item })
    await writeIndex(idx)
    for (const item of (idx.chats || []).filter(function (entry) { return entry.cardPath === cardPath })) {
      const linked = await readChat(item.id)
      if (linked !== undefined && linked.cardName !== cardName) {
        linked.cardName = cardName
        await writeChat(linked, { source: 'card-name.sync' })
      }
    }
  }
  async function restoreCurrentCard(sessionId, approvalToken, expectedDigest, beforeRestore) {
    let chat = await chatForSession(sessionId)
    if (chat === undefined) throw new Error('当前会话没有绑定人物卡')
    if ((chat.mode || 'story') !== 'card') throw new Error('原版恢复只能在卡片模式中使用')
    const cardPath = str(chat.cardPath)
    if (cardPath === '') throw new Error('空白工作台没有可恢复的正式人物卡')
    return oneTimeApprovals.consume(approvalToken,{sessionId,action:'card-restore',target:cardPath,revision:expectedDigest},async () => {
      const result = await restoreApprovedCard(cardPath,expectedDigest)
      if (beforeRestore) await beforeRestore()
      return result
    })
  }
  async function restoreApprovedCard(cardPath, expectedDigest) {
    const restored = await fileResources.restoreCard(cardPath, payload => cardPreparation.create({kind:'import',payload}), {expectedDigest})
    const restoredCard = cardPreparation.project(restored.card)
    await bumpCardProjectionRevision(cardPath)
    await syncCardName(cardPath, restoredCard.name)
    return {
      path: cardPath,
      name: restoredCard.name,
      originalPath: restored.originalPath,
      backupPath: restored.backupPath
    }
  }
  async function confirmationPreview(args) {
    const sessionId = str(args.sessionId) || 'profile-library'
    if (args.action === 'profile-confirm') {
      const value = await userPreferenceProfile.read(args.profileId)
      if (!value.draft) throw new Error('尚无可确认的用户画像草案')
      return {sessionId,action:args.action,target:value.profileId,revision:String(value.draft.revision),name:value.name,draft:value.draft}
    }
    if (args.action === 'card-restore') {
      const target = normalizeResourcePath(args.path,'card'), source = await fileResources.readText(target)
      if (!source) throw new Error('人物卡工作版不存在')
      return {sessionId,action:args.action,target,revision:createHash('sha256').update(source).digest('hex'),name:cardPreparation.project(JSON.parse(source)).name}
    }
    throw new Error('未知确认操作')
  }
  async function deleteCard(cardPath) {
    const result = await cardDeletion.remove(cardPath)
    if (result.deleted) await cardOrganization.movePath(normalizeResourcePath(cardPath, "card"), null)
    return result
  }
  async function stopChatForDeletion(chatId) {
    const chat = await readChat(str(chatId))
    if (!chat) return
    const postCommit = spPostCommitControls.get(chat.sessionId)
    if (postCommit) { postCommit.skipOptional = true; postCommit.controller.abort(new Error('对话正在删除')) }
    const ids = new Set([chat.sessionId, ...Object.values(storyTimeline.inspect({ chat }).participants || {}).map(item => item.sessionId)])
    const workers = [...ids].map(id => agentRegistry.get(id)).filter(Boolean)
    for (const worker of workers) {
      if (typeof worker.cancel === 'function') worker.cancel({ kind: 'user' })
    }
    await cancelSettlement(chat.id)
    backgroundAgentRunner.cancel(chat.sessionId,{includeSidecars:true})
    clearTimeout(compactionTimers.get(chat.sessionId));compactionTimers.delete(chat.sessionId)
    await Promise.all([autoCompaction?.stop(chat.id),helperGenerations.stopSession(chat.sessionId),sceneIllustrations?.stopChat(chat.id),spDatabase.cancel(chat.sessionId),spDatabase.cancelInspiration(chat.sessionId),spDatabase.cancelPlot(chat.sessionId)])
    for (const worker of workers) {
      if (typeof worker.whenIdle === 'function') await worker.whenIdle()
    }
    await spPostCommitJobs.get(chat.sessionId)?.catch(()=>{})
    const deadline=Date.now()+10000
    while(await retentionBusy(chat)){if(Date.now()>=deadline)throw Error('对话仍有任务尚未停止，请稍后重试删除');await new Promise(resolve=>setTimeout(resolve,50))}
  }
  async function deleteChats(chatIds, prepareOnly = false) {
    if (!Array.isArray(chatIds) || chatIds.some(id => typeof id !== 'string' || !id.trim())) throw new Error('请选择有效的对话')
    const results = []
    // Registry index updates must remain sequential.
    for (const chatId of new Set(chatIds)) {
      try {
        const result = prepareOnly ? await stopChatForDeletion(chatId) : await deleteChat(chatId)
        results.push({ chatId, ok: true, ...(result?.logicalDeletion ? {logicalDeletion:true,physicalCleanup:result.physicalCleanup,cleanupReason:result.cleanupReason,bytesFreed:result.bytesFreed} : {}) })
      } catch (error) { results.push({ chatId, ok: false, error: String(error?.message || error) }) }
    }
    return { results }
  }
  async function deleteChat(chatId) {
    if(deletingChatIds.has(chatId))throw Error('对话正在删除')
    deletingChatIds.add(chatId)
    try{
      await stopChatForDeletion(chatId)
      return await maintenanceGate.write(async()=>{
        const chat=await readChat(chatId)
        if(chat&&await retentionBusy(chat))throw Error('对话任务已重新开始，未删除')
        const result=await conversationRegistry.remove(chatId)
        deletedChatIds.add(chatId)
        if(chat){
          try{const cleanup=await profileRetention.removeChatArtifacts(chat);if(cleanup?.reason==='format4-no-gc')return {...result,logicalDeletion:true,physicalCleanup:'protected',cleanupReason:cleanup.reason,bytesFreed:cleanup.bytes||0}}catch(error){await profileData.writeJson('recovery/deletions/'+createHash('sha256').update(chatId).digest('hex')+'.json',{version:1,chat:{id:chat.id,sessionId:chat.sessionId},cleanupPending:true,error:String(error.message||error)});return {...result,cleanupPending:true,cleanupError:String(error.message||error)}}
        }
        return result
      })
    }finally{deletingChatIds.delete(chatId)}
  }
  async function exportConversation(chatId, sessionId, title) {
    const chat = await profileSessionAccess.exportTarget(chatId, sessionId)
    if (chat === undefined) throw new Error('当前 Session 没有绑定 Tavern 对话')
    const exported = createConversationTextExport(chat, { title: str(title) })
    if (exported.messageCount === 0) throw new Error('暂无可导出的对话')
    return exported
  }
  async function exportTavernLogs(sessionId) {
    const chat = await chatForSession(str(sessionId))
    if (!chat) throw new Error('当前 Session 没有绑定 Tavern 对话')
    const diagnostic = await mvuDiagnostics.read(sessionId)
    const backgroundSessionIds = [...new Set(diagnostic.records.map(record => record.traceSessionId).filter(Boolean))]
    let imageDiagnostic
    try { imageDiagnostic = sceneDiagnostics === null ? { version: 1, records: [] } : await sceneDiagnostics.read(chat.id) }
    catch { imageDiagnostic = { version: 1, records: [], error: '生图诊断读取失败，仍导出 Session 与 MVU 日志。' } }
    let compatibilityDiagnostic
    try { compatibilityDiagnostic = await compatibilityDiagnostics.read(sessionId) }
    catch { compatibilityDiagnostic = { version: 1, records: [], error: '兼容能力诊断读取失败，仍导出其他日志。' } }
    const cardDiagnostics = { version: 1, capturedAt: Date.now(), source: 'export-time', cardPath: chat.cardPath, errors: [] }
    try { cardDiagnostics.card = await readChatCard(chat) }
    catch { cardDiagnostics.errors.push('人物卡读取失败') }
    try { cardDiagnostics.extensions = await readCardExtensions(chat.cardPath) }
    catch { cardDiagnostics.errors.push('脚本与正则配置读取失败') }
    try {
      const worldbook = cardDiagnostics.card ? await worldBooks.bound(chat.cardPath, cardDiagnostics.card, chat) : null
      cardDiagnostics.worldbook = worldbook ? { source: worldbook.source, document: worldbook.view.raw } : null
    } catch { cardDiagnostics.errors.push('绑定世界书读取失败') }
    const exported = await createMvuDiagnosticExport({ sourceDiagnostics:tavernSourceDiagnostics(sessionDebugEvidence(sessionId).events), cardDiagnostics, performanceDiagnostics: performanceDiagnostics.read(), updateDiagnostics: applicationUpdater.diagnostics(), sessionId, backgroundSessionIds, displayDiagnostics: { version: 1, frames: (chat.messages || []).slice(-20).flatMap(message => (displayDiagnostics.read(chat,message)?.frames || []).map(frame => ({ turn: message.turn, partIndex: frame.partIndex, panelId: frame.panelId, placement: frame.placement, capturedAt: frame.capturedAt, status: frame.status, console: frame.console, errors: frame.errors, network: frame.network }))) }, apiDiagnostics: await apiDiagnostics.read(sessionId).catch(() => null), compatibilityDiagnostics: compatibilityDiagnostic, store: mvuDiagnostics, sceneDiagnostics: imageDiagnostic, sessions: sessionStore, persistence: ctx.get('sessionPersistence'), query: ctx.get('sessionQuery'), attachments: ctx.get('attachments'), environment: { mvu: OFFICIAL_MVU_VERSION, mvuAsset: inspectOfficialMvuAsset(), runtime: { generation: runtimeGeneration, platform: process.platform, arch: process.arch, nodeVersion: process.version } } })
    return { filename: exported.filename, base64: exported.buffer.toString('base64') }
  }
  async function attachPlayChatDebug(targetSessionId, sourceSessionId, turn) {
    const editorChat = await chatForSession(str(targetSessionId))
    const sourceChat = await chatForSession(str(sourceSessionId))
    if (editorChat === undefined) throw new Error('卡片工作台对话不存在')
    if (sourceChat === undefined) throw new Error('游玩对话不存在')
    const reference = createPlayChatDebugReference(editorChat, sourceChat, turn)
    const mounted = Array.isArray(editorChat.workspace && editorChat.workspace.mountedResources) ? editorChat.workspace.mountedResources : []
    editorChat.workspace.mountedResources = mounted.filter(function (item) {
      return !item || item.kind !== 'play-chat' || item.path !== reference.path
    }).concat([reference])
    await writeChat(editorChat, { source: 'play-chat.attach' })
    return reference
  }

  function assistantMessageAtTurn(chat, requestedTurn) {
    const messages = Array.isArray(chat && chat.messages) ? chat.messages : []
    let inferred = 1
    for (const message of messages) {
      if (message && message.role === 'user') inferred += 1
      if (message && message.role === 'assistant' && Math.max(1, Number(message.turn) || (message.greeting === true ? 1 : inferred)) === requestedTurn) return message
    }
    return null
  }

  function cleanRuntimeUrl(value) {
    return str(value).split(/[?#]/)[0].replace(/\/\/[^/@\s]+@/, '//').slice(0, 1000)
  }

  function sanitizeDisplayRuntime(value) {
    const input = value && typeof value === 'object' ? value : {}
    function scalar(item, limit = 4000) {
      if (item === null || item === undefined || typeof item === 'boolean' || typeof item === 'number') return item
      if (typeof item === 'string') return item.slice(0, limit)
      try { return JSON.parse(JSON.stringify(item).slice(0, limit)) } catch { return str(item).slice(0, limit) }
    }
    return {
      capturedAt: Math.max(0, Number(input.capturedAt) || Date.now()),
      mvuViewUsed: input.mvuViewUsed === true,
      panelId: str(input.panelId).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80),
      placement: input.placement === "sidebar" ? "sidebar" : "message",
      dom: str(input.dom).slice(0, 100000),
      console: (Array.isArray(input.console) ? input.console : []).slice(-100).map(function (item) {
        return { at: Math.max(0, Number(item && item.at) || 0), level: ['log', 'info', 'warn', 'error'].includes(item && item.level) ? item.level : 'log', args: scalar(item && item.args, 12000) }
      }),
      network: (Array.isArray(input.network) ? input.network : []).slice(-100).map(function (item) {
        return { at: Math.max(0, Number(item && item.at) || 0), kind: item && item.kind === 'xhr' ? 'xhr' : 'fetch', method: str(item && item.method).slice(0, 16), url: cleanRuntimeUrl(item && item.url), status: Math.max(0, Number(item && item.status) || 0), durationMs: Math.max(0, Number(item && item.durationMs) || 0), failed: item && item.failed === true, error: str(item && item.error).slice(0, 1000) }
      }),
      errors: (Array.isArray(input.errors) ? input.errors : []).slice(-100).map(function (item) {
        return { at: Math.max(0, Number(item && item.at) || 0), kind: str(item && item.kind).slice(0, 32), message: str(item && item.message).slice(0, 4000), tag: str(item && item.tag).slice(0, 32), url: cleanRuntimeUrl(item && item.url || item && item.source), line: Math.max(0, Number(item && item.line) || 0), column: Math.max(0, Number(item && item.column) || 0) }
      })
    }
  }

  function comparableDisplayRuntime(value) {
    const runtime = value && typeof value === 'object' ? value : {}
    return {
      mvuViewUsed: runtime.mvuViewUsed === true,
      panelId: str(runtime.panelId),
      placement: runtime.placement,
      dom: str(runtime.dom),
      console: (Array.isArray(runtime.console) ? runtime.console : []).map(function (item) {
        return { level: item && item.level, args: item && item.args }
      }),
      network: (Array.isArray(runtime.network) ? runtime.network : []).map(function (item) {
        return { kind: item && item.kind, method: item && item.method, url: item && item.url, status: item && item.status, failed: item && item.failed, error: item && item.error }
      }),
      errors: (Array.isArray(runtime.errors) ? runtime.errors : []).map(function (item) {
        return { kind: item && item.kind, message: item && item.message, tag: item && item.tag, url: item && item.url, line: item && item.line, column: item && item.column }
      })
    }
  }

  function sameDisplayRuntimeCapture(left, right) {
    return JSON.stringify(comparableDisplayRuntime(left)) === JSON.stringify(comparableDisplayRuntime(right))
  }

  async function captureDisplayRuntime(sessionId, requestedTurn, partIndex, runtime) {
    const chat = await chatForSession(str(sessionId))
    if (chat === undefined || groupOfMode(chat.mode) !== 'play') throw new Error('当前 Session 没有绑定游玩对话')
    const turn = Math.max(1, Number(requestedTurn) || 0)
    const message = assistantMessageAtTurn(chat, turn)
    if (message === null) throw new Error('游玩记录中不存在第 ' + turn + ' 轮回复')
    const index = Math.max(0, Math.min(100, Number(partIndex) || 0))
    let capture = sanitizeDisplayRuntime(runtime)
    const existingRuntime = message.displayRuntime && typeof message.displayRuntime === 'object' ? message.displayRuntime : null
    const sourceActivityAt = Math.max(0, Number(existingRuntime && existingRuntime.sourceActivityAt) || Number(chat.updatedAt) || 0)
    const latestTurn = Math.max.apply(null, (chat.messages || []).filter(function (item) { return item && item.role === 'assistant' }).map(function (item) { return Math.max(1, Number(item.turn) || 1) }).concat([1]))
    capture.captureKind = turn === latestTurn && Date.now() - sourceActivityAt < 300000 ? 'live' : 'replay'
    const current = displayDiagnostics.read(chat,message) || { frames: [] }
    const currentFrames = Array.isArray(current.frames) ? current.frames : []
    const existingFrame = currentFrames.find(function (item) { return Number(item && item.partIndex) === index && str(item.panelId) === capture.panelId })
    if (existingFrame && existingFrame.mvuViewUsed === true) capture.mvuViewUsed = true
    if (existingFrame && capture.mvuViewUsed === true && capture.dom === '' && capture.console.length === 0 && capture.network.length === 0 && capture.errors.length === 0) {
      capture = Object.assign({}, existingFrame, {
        capturedAt: capture.capturedAt,
        captureKind: capture.captureKind,
        mvuViewUsed: true
      })
    }
    if (existingFrame && sameDisplayRuntimeCapture(existingFrame, capture)) return { captured: false, turn, partIndex: index, captureKind: capture.captureKind }
    const identity=displayMessageIdentity(chat,message)
    const savedFrames=Array.isArray(existingRuntime?.frames)?existingRuntime.frames:[]
    const saved=savedFrames.find(item=>Number(item?.partIndex)===index&&str(item.panelId)===capture.panelId)
    // Repeated rendering changes only the evidence buffer. Persist a new locator
    // or an MVU marker atomically, without overwriting concurrent story edits.
    if(!saved||saved.placement!==capture.placement||saved.mvuViewUsed!==capture.mvuViewUsed||['dom','console','network','errors'].some(key=>Object.hasOwn(saved,key))){
      await updateChat(chat.id,current=>{
        const target=assistantMessageAtTurn(current,turn)
        if(!target||displayMessageIdentity(current,target)!==identity)throw Error('该轮内容已变化，请重新采集显示诊断')
        const old=target.displayRuntime||{frames:[]}
        if(old.frames?.some(item=>Number(item?.partIndex)===index&&str(item.panelId)===capture.panelId&&item.mvuViewUsed===true))capture.mvuViewUsed=true
        const frames=(old.frames||[]).filter(item=>Number(item?.partIndex)!==index||str(item.panelId)!==capture.panelId)
        frames.push({partIndex:index,panelId:capture.panelId,placement:capture.placement,mvuViewUsed:capture.mvuViewUsed,capturedAt:capture.capturedAt})
        target.displayRuntime={version:2,sourceActivityAt:Number(old.sourceActivityAt)||sourceActivityAt,frames:boundDisplayCaptures(frames)}
        return current
      },{source:'display.capture',touchUpdatedAt: false})
    }
    displayDiagnostics.put(chat,message,{partIndex:index,...capture})
    return { captured: true, turn, partIndex: index, captureKind: capture.captureKind }
  }
  const historyOperations=createTavernHistoryOperations({
    chats:{forSession:chatForSession,update:updateChat},
    sessions:{get:id=>agentRegistry.get(id) || {session:sessionStore.get(id)},flush:session=>sessionStore.flush(session)},
    activity:chat=>backgroundTasks.activity(chat),exclusive:(id,work)=>backgroundTasks.exclusive(id,work),
    prepareHistory:async(before,after)=>{
      if(!await fullTemplateEnabled(after,{texts:after.messages.filter((row,index)=>row.text!==before.messages[index]?.text).map(row=>row.sourceText??row.text)}))return helperEvents.stageHistory(before,after)
      const previous=new Map(before.messages.map(row=>[row.tavernHistoryKey,row])),events=[]
      if(before.messages.some(row=>!after.messages.some(next=>next.tavernHistoryKey===row.tavernHistoryKey)))events.push({kind:'event',name:'MESSAGE_DELETED',args:[after.messages.length]})
      for(const [messageId,row]of after.messages.entries()) {
        const prior=previous.get(row.tavernHistoryKey)
        const isUser=(row.tavernRoleOverride||row.tavernRole||row.role)==='user'
        const event=!prior?(isUser?'MESSAGE_SENT':'MESSAGE_RECEIVED'):(Number(row.swipeId)||0)!==(Number(prior.swipeId)||0)?'MESSAGE_SWIPED':(row.sourceText??row.text)!==(prior.sourceText??prior.text)?'MESSAGE_UPDATED':null
        if(event)events.push({kind:'message',messageId,event})
      }
      if(!events.length)return helperEvents.stageHistory(before,after)
      const prepared=await fullTemplateCommitter.prepareHistory({chat:after,events,envelope:await tavernScriptHostAdapter.readFullPromptTemplateState(after.sessionId,after),serviceContext:await fullTemplateServiceContext(after.sessionId,after)});return helperEvents.stageHistory(before,prepared)
    },
    afterCommit:async sessionId=>{await fullTemplateCommitter.flush(sessionId);helperEvents.schedule(sessionId)}
  })
  helperWorldbooks=createHelperWorldbookLibrary({worldBooks,store:profileData,chats:{forSession:chatForSession,update:updateChat,read:readChat,list:async()=>(await readIndex()).chats.map(row=>row.id)},readCard:readChatCard,assertOwner:assertHelperOwner})
  const backgroundScripts=createTavernBackgroundScriptExecutor({rpc:dispatchMethod,dispatch:tavernScriptDispatch,view:sessionView,onRetainedDiscarded:(sessionId,details)=>{void mvuDiagnostics.record(sessionId,{stage:'sp-drain-lost',runtimeId:details.runtimeId,error:[details.reason,details.error].filter(Boolean).join('：').slice(0,2000)}).catch(error=>console.warn('SP 保存失联诊断写入失败',error))},networkPolicy:async(sessionId,sources,kind)=>{
    if(await outboundDisabled())return false
    const chat=await chatForSessionReadonly(sessionId);if(!chat)return false
    if(kind==='websocket'){
      // Per-frame CSP admits WebSockets only for network-capable realms. HTTP
      // can additionally carry exact frame ownership; Playwright WS routes cannot.
      const scripts=await effectiveHelperScripts(chat)
      return (await Promise.all(scripts.map(script=>scriptPolicy(chat,script.id)))).some(policy=>policy.capabilities.includes('network'))
    }
    return sources.length>0&&(await Promise.all(sources.map(id=>scriptPolicy(chat,id)))).every(policy=>policy.capabilities.includes('network'))
  },assets:async(pathname,sessionId,url,request)=>{
    const input={method:request.method,url:url.pathname+url.search,headers:request.headers}
    const read=async req=>{const asset=await frameResources.read(req);return {...asset,headers:{...tavernResourceHeaders(asset.mediaType),'Cache-Control':'private, no-store','Cross-Origin-Resource-Policy':'cross-origin'}}}
    if(pathname.startsWith('/api/dsh-tavern/frame-assets/'))return read(input)
    if(pathname==='/api/dsh-tavern/static-assets'||/^\/api\/dsh-tavern\/remote-assets\/[0-9a-f]{64}(?:\/[^/]*)?$/i.test(pathname)){
      // Script realms are isolated per owner. Resolve the real frame's current
      // capability, never a scriptId supplied in the requested URL.
      const token=request.sources?.length===1?frameResources.currentAccess(sessionId,request.sources[0]):null
      if(!token)throw Object.assign(Error('后台资源缺少有效脚本归属'),{status:403})
      return read({...input,url:'/api/dsh-tavern/frame-assets/'+token+'/?url='+encodeURIComponent(input.url)})
    }
  }})
  ctx.effect(()=>()=>backgroundScripts.dispose(),'dsh-tavern: background script executor')
  const helperPresetVariables=createHelperPresetVariables({store:profileData,readPreset:name=>name==='builtin'?null:readPresetDocument(name)})
  const scriptVariablePolicy=createScriptVariablePolicy({store:profileData,chats:{forSession:chatForSession,update:updateChat},scripts:effectiveHelperScripts,readCardVariables:async chat=>(await readCardExtensions(chat.cardPath))?.variables||{},readStorage:(chat,scripts)=>scriptServices.storageSnapshot(scripts.map(script=>script.id),chat),isBusy:chat=>backgroundTasks.activity(chat).busy||Boolean(chat.regenInProgress)||agentRegistry.get(chat.sessionId)?.phase?.kind==='running'})
  const tavernScriptHostAdapter = createTavernScriptHostAdapter({
    readDisplayedMessageIdentity:async(sessionId,messageId)=>{
      const chat=await chatForSessionReadonly(sessionId),session=sessionStore.get(str(sessionId))||agentRegistry.get(str(sessionId))?.session;
      if(!chat||!session||await outboundDisabled())return null;
      const scripts=(await effectiveHelperScripts(chat)).filter(script=>!script.uiKind&&!script.originalUi);
      const scriptIds=(await Promise.all(scripts.map(async script=>(await scriptPolicy(chat,script.id))?.trustedCardMode===true?script.id:null))).filter(Boolean);
      return readDisplayedMessageIdentity(chat,session,messageId,scriptIds);
    },
    scriptVariables:scriptVariablePolicy,
    promptLimits:capacityLimits.prompts,
    assertOwner:assertHelperOwner, scriptPolicy,
    hasScripts: async chat => hasTavernScriptRuntime(chat, await effectiveHelperScripts(chat)),
    presetVariables:helperPresetVariables,
    resourceLibrary:helperWorldbooks,
    history:historyOperations,
    recordResourceSave: (sessionId, summary) => apiDiagnostics.recordResourceSave(sessionId, summary),
    publishCreatedMessages: async function (chat, targets) {
      const session = sessionStore.get(chat.sessionId) || agentRegistry.get(chat.sessionId)?.session
      appendHelperUserSessionContext(session, chat, targets)
      await sessionStore.flush(session)
    },
    resolveChat: chatForSession,
    writeChat,
    updateChat,
    readChatRevision,
    readCard: readChatCard,
    worldBooks,
    scriptDispatch: tavernScriptDispatch,
    runtimeInvalidated: sessionId => sessionSignals.publish(sessionId, { kind: 'tavern-state', version: 'mvu-fence:' + Date.now() }),
    ensureRuntime:sessionId=>backgroundScripts.ensure(sessionId),
    eventExecutor:input=>backgroundScripts.execute(input),
    extensionSettings: tavernExtensionSettings,
    fullExtensionSettings: createTavernExtensionSettings(profileData),
    extensionSettingsChanged: async function (sessionId) {
      sessionSignals.publish(sessionId, { kind: 'tavern-state', version: 'extension-settings:' + await profileData.version('tavern-extension-settings.json') })
    },
    globalVariables: promptTemplateGlobalVariables,
    characterVariables: {
      save: async function (cardPath, variables, sessionId) {
        const saved = await replaceCardVariables(cardPath, variables)
        sessionSignals.publish(sessionId, { kind: 'tavern-state', version: 'character-variables:' + Date.now() })
        return saved
      }
    },
    diagnostics: mvuDiagnostics,
    hasScripts: async function (chat) { return hasTavernScriptRuntime(chat, await effectiveHelperScripts(chat)) },
    isPlayChat: function (chat) { return groupOfMode(chat.mode) === 'play' }
  })

  async function fullTemplateRpc(method, args) {
    if(method==='loadFullPromptTemplateWorldInfo')return tavernScriptHostAdapter.loadFullPromptTemplateWorldInfo(args.sessionId,args.name)
    if (method === 'getFullPromptTemplateState') return tavernScriptHostAdapter.readFullPromptTemplateState(args.sessionId)
    if (method === 'saveFullPromptTemplateState') return tavernScriptHostAdapter.saveFullPromptTemplateState(args.sessionId, args.state)
    if (method === 'saveFullPromptTemplateGlobals') return tavernScriptHostAdapter.saveFullPromptTemplateGlobals(args.sessionId, args.variables, args.expectedVariables)
    if (method === 'saveFullPromptTemplateSettings') return tavernScriptHostAdapter.saveFullPromptTemplateSettings(args.sessionId, args.settings, args.expectedSettings)
    throw new Error('未知模板操作')
  }
  // Template rendering uses the same pinned card renderers as the view and the opening page (Z92):
  // a remote page named in a display regex loads from its local pin, also offline.
  async function pinnedCardRegexScripts(cardPath) {
    const extensions=await readCardExtensions(cardPath)
    return (await tavernRemoteAssets.pinExtensions({helperScripts:[],regexScripts:extensions?.regexScripts||[]})).regexScripts||[]
  }
  async function fullTemplateServiceContext(sessionId, draft) {
    const chat=draft || await chatForSession(sessionId)
    if(!chat)throw new Error('模板游戏不存在')
    return {model:modelSelection(sessionId)?.model||'',characterFilename:chat.cardPath,regexScripts:[...await pinnedCardRegexScripts(chat.cardPath),...(effectiveGamePreset(chat)?.regexScripts||[])],macroState:chat.macroState,charName:chat.cardName}
  }
  async function templateNetworkPolicy(sessionId,scriptId) {
    if(await outboundDisabled())return false
    const chat=await chatForSessionReadonly(sessionId);if(!chat)return false
    if(scriptId)return (await scriptPolicy(chat,scriptId)).capabilities.includes('network')
    if(!(await cardPermissions.read(await cardSecurityIdentity(chat))).capabilities.includes('network'))return false
    const preset=effectiveGamePreset(chat)
    return !JSON.stringify(preset?.compatibilityPresetDocument||{}).includes('<%')||Boolean((await cardPermissions.readResource('preset',preset.presetPath)).capabilities.includes('network'))
  }
  const fullPromptTemplates = createFullPromptTemplateExecutor({rpc:fullTemplateRpc,serviceContext:fullTemplateServiceContext,networkPolicy:templateNetworkPolicy})
  const fullTemplateCommitter = createFullPromptTemplateCommitter({
    retention:retentionLimits,
    readWorldbook:(name,chat)=>tavernScriptHostAdapter.loadFullPromptTemplateWorldInfo(chat.sessionId,name,chat),
    execute: fullPromptTemplates.execute, rpc: fullTemplateRpc, chats: { forSession: chatForSession, update: updateChat },
    project: async (text, chat, message) => {
      const projectionText = renderCardText(text, { name: chat.cardName }, chat.macroState)
      return projectRuntimeReply(text, { projectionText, regexScripts: [...await pinnedCardRegexScripts(chat.cardPath), ...(effectiveGamePreset(chat)?.regexScripts || [])], placement: message?.role==='user'?1:2, isEdit: Boolean(message?.edited), depth: message?.messageId===undefined?0:chat.messages.length-1-message.messageId })
    }
  })
  const helperEvents=createTavernHelperEventJournal({chats:{forSession:chatForSession,update:updateChat},dispatch:input=>tavernScriptHostAdapter.dispatchEvent(input),enabled:async chat=>hasTavernScriptRuntime(chat,await effectiveHelperScripts(chat)),
    waitForIdle:(sessionId,options)=>tavernScriptDispatch.waitForIdle(sessionId,options),
    cardCore:async chat=>{const pinned=await tavernRemoteAssets.pinExtensions({helperScripts:await effectiveHelperScripts(chat),regexScripts:[]}),selection=selectMvuRuntime(pinned.helperScripts,{enabled:chat.mvu?.enabled===true});if(selection?.owner!=='card'||selection.status!=='selected')return null;const source=projectTavernHelperScripts(pinned.helperScripts,chat.tavernHelperScriptVariables).scripts.find(script=>script.id===selection.scriptId);return source?{id:source.id,sourceDigest:createHash('sha256').update(String(source.content||'')).digest('hex')}:null},
    ensureCardMvuRuntime:sessionId=>backgroundScripts.ensure(sessionId),
    isCardMvuReady:sessionId=>{const state=tavernScriptDispatch.status(sessionId);return state.ready&&!state.mvuValidationBlocked&&state.cardMvuPendingVersion===1&&state.cardMvuScopeVersion===1}
  })
  const resumeCardMvu=sessionId=>helperEvents.resumeCardMvu(sessionId).catch(error=>console.warn('卡核心待办恢复暂停：',String(error.message||error)))
  const stopCardMvuRecovery=tavernScriptDispatch.subscribeSettled(sessionId=>{void resumeCardMvu(sessionId)})
  void Promise.resolve(conversationRegistry.list()).then(async rows=>{for(const row of rows)await resumeCardMvu(row.sessionId)}).catch(error=>console.warn('卡核心待办扫描暂停：',String(error.message||error)))
  ctx.effect(()=>()=>{stopCardMvuRecovery();helperEvents.dispose()},'dsh-tavern: card MVU pending recovery')
  ctx.effect(() => () => fullPromptTemplates.dispose(), 'dsh-tavern: full prompt templates')
  const templateEnginePolicy=createTemplateEnginePolicy()
  async function templateEngineStatus(chatOrId,options={}) {
    const chat=typeof chatOrId==='string'?await chatForSessionReadonly(chatOrId):chatOrId
    if(!chat)throw new Error('当前游玩不存在')
    const settings=(await profileData.readJson('tavern-extension-settings.json'))?.EjsTemplate||{}
    const warnings=[]
    const unavailable=kind=>error=>{warnings.push({kind,message:String(error.message||error)});return null}
    const card=Object.hasOwn(options,'card')?options.card:chat.cardPath?await readChatCard(chat).catch(unavailable('card')):{}
    const worldbook=Object.hasOwn(options,'worldbook')?options.worldbook:chat.cardPath?await worldBooks.bound(chat.cardPath,card,chat).catch(unavailable('worldbook')):null
    return {...templateEnginePolicy.resolve({chat,settings,card,preset:options.preset??effectiveGamePreset(chat),worldbook,texts:options.texts,api:options.api}),warnings}
  }
  async function fullTemplateEnabled(chat,options) {return (await templateEngineStatus(chat,options)).engine==='full'}
  async function lightTemplateEnabled(chat,options) {return (await templateEngineStatus(chat,options)).engine==='lightweight'}

  function sessionDebugEvidence(sessionId) {
    const id = str(sessionId)
    if (id === '') return { sessionId: '', loaded: false, events: [] }
    let session = null
    try {
      const sessions = ctx.get('sessions')
      session = sessions && typeof sessions.get === 'function' ? sessions.get(id) : null
    } catch {}
    if (!session) {
      try {
        const agent = agentRegistry.get(id)
        session = agent && agent.session
      } catch {}
    }
    return { sessionId: id, loaded: Boolean(session && (typeof session.snapshotEvents === 'function' || Array.isArray(session.events))), events: sessionEvents(session) }
  }

  // ---------- 聊天 ----------
  function cardViewOf(card, chat) {
    if (card === null || card === undefined) {
      const draft = chat.workspace && chat.workspace.draft ? chat.workspace.draft : {}
      return {
        path: '',
        name: str(draft.name) || '卡片工作台',
        description: str(draft.description),
        personality: str(draft.personality),
        scenario: str(draft.scenario),
        first_mes: str(draft.first_mes),
        mes_example: str(draft.mes_example),
        system_prompt: str(draft.system_prompt),
        post_history_instructions: str(draft.post_history_instructions),
        creator_notes: '',
        tags: Array.isArray(draft.tags) ? draft.tags : [],
        alternate_greetings: [],
        character_book: null
      }
    }
    return Object.assign(cardPreparation.present({ card: card, as: 'sillytavern-context' }), { path: str(card.path || chat.cardPath) })
  }
  const viewProjectionCache=createDependencyProjectionCache()
  const sessionViewCache=createDependencyProjectionCache()
  const sessionViewTransport=createSessionViewTransport()
  // Assigned with the background coordinator below; a view built before that reports the stored state.
  let manualCharacterDesign = null
  async function view(chat, card) {
    const unloadIdentity=maintenanceChatIdentity.get(chat.id),unloadPackageDigest=extensionRuntime.status().installed?.digest,unloadExtensionRevision=extensionRuntime.status().revision
    return viewProjectionCache.read(chat.sessionId,[chat,card],async use=>{
    await use(readTavernSettings)
    let scriptProgress = null
    if ((chat.mode || 'story') === 'script') {
      const script = await use(()=>readScript(chat.cardPath))
      if (script !== undefined && Array.isArray(script.chunks)) {
        scriptProgress = scriptContinuity.inspect({ script: script, state: chat.scriptState, request: { kind: 'progress' } })
      }
    }
    const activePresetSnapshot = groupOfMode(chat.mode) === 'play' ? effectiveGamePreset(chat) : null
    let replyDisplay = { projections: replyProjectionsOf(chat), presentation: null, latestSourceBacked: false }
    let cardExtensions = { regexScripts: [], helperScripts: [] }
    if ((chat.mode || 'story') === 'story' || (chat.mode || 'story') === 'script') {
      cardExtensions = await use(()=>readCardExtensions(chat.cardPath)) || cardExtensions
      const extensionSource=cardExtensions
      const pinnedExtensions = await use(()=>tavernRemoteAssets.pinExtensions(extensionSource))
      cardExtensions = Object.assign({}, cardExtensions, {
        helperScripts: pinnedExtensions.helperScripts,
        regexScripts: pinnedExtensions.regexScripts,
        remoteAssetDiagnostics: pinnedExtensions.diagnostics,
        remoteAssetPins: pinnedExtensions.pins
      })
      const presetRegexScripts = Array.isArray(activePresetSnapshot && activePresetSnapshot.regexScripts) ? activePresetSnapshot.regexScripts : []
      replyDisplay = projectRuntimeReplyHistory(chat.messages, {
        charName: chat.cardName,
        macroState: chat.macroState,
        regexScripts: composeTavernRegexScripts(cardExtensions, presetRegexScripts),
        placement: 2,
        isMarkdown: true,
        isEdit: false,
        depth: 0
      })
      const persistentStatus = projectPersistentStatusView(chat.messages, replyDisplay.projections, {
        charName: chat.cardName,
        macroState: chat.macroState,
        regexScripts: cardExtensions.regexScripts
      })
      replyDisplay.projections = persistentStatus.projections
      replyDisplay.statusView = persistentStatus.statusView
      replyDisplay.statusViews = persistentStatus.statusViews
      replyDisplay.projections = withLegacyPresentationProjection(chat, replyDisplay.projections)
    }
    let activity = backgroundTasks.activity(chat)
    const recoveryFailure = await use(()=>mvuSettlementReconciler.status(chat.sessionId))
    if (recoveryFailure.blocked && activity.phase === 'pending') activity = { ...activity, phase:'failed', role:'settlement', busy:false, reason:'recovery-failed' }
    const debugTurns = []
    for (const message of Array.isArray(chat.messages) ? chat.messages : []) {
      if (!message || message.role !== 'assistant') continue
      const turn = Math.max(0, Number(message.turn) || (message.greeting === true ? 1 : 0))
      if (turn === 0) continue
      const source = (str(message.sourceText) || str(message.text)).replace(/\s+/g, ' ').trim()
      debugTurns.push({ turn, preview: source.slice(0, 90), chars: source.length })
    }
    const latestStoryTurn = Number(debugTurns[debugTurns.length - 1]?.turn) || 0
    const nativeSnapshot = await use(async()=>{
      const session=sessionStore.get(str(chat.sessionId)) || agentRegistry.get(str(chat.sessionId))?.session
      // A cold view must still recognize durable command carriers. Inspect only
      // when empty pending-input mirrors need attribution; do not activate an Agent.
      if (!session && Object.values(chat.runtimeInputs || {}).some(input => input?.source === '')) {
        const controller = ctx.get('sessionController')
        if (controller?.inspect) {
          const persisted = await controller.inspect(str(chat.sessionId))
          return { events: persisted.events, surface: null }
        }
      }
      // Native SurfaceManager.nodes is a prototype getter, not JSON data.
      // Materialize only the read model before use() snapshots its dependency.
      const surface = session?.surface
      return {events:sessionEvents(session),surface:surface ? {nodes:surface.nodes} : null}
    })
    const liveSession = nativeSnapshot
    const nativeBodyMessageIds = {}
    const nativeNodes = new Set(liveSession?.surface?.nodes || [])
    const nativeEvents = sessionEvents(liveSession)
    for (const event of nativeEvents) {
      if (event.type !== 'assistant/message' || !nativeNodes.has(event.seq) || !event.data.message.content.some(block => block.type === 'text' && block.text)) continue
      if (event.data.message.source?.model === 'synthetic-trajectory') continue
      nativeBodyMessageIds[tavernAssistantTurn(event, nativeEvents)] = event.data.message.id
    }
    const latestAssistant = latestStoryTurn > 0 ? assistantResultForTurn(liveSession, latestStoryTurn) : null
    const latestAssistantMessageId = str(latestAssistant?.event?.data?.message?.id)
    const forkTurnsByMessageId = conversationForkTurnsByMessageId(liveSession, debugTurns.map(item => item.turn))
    const inputSources = {}
    const userProjections = []
    const displayScripts = composeTavernRegexScripts(cardExtensions, activePresetSnapshot?.regexScripts)
    const projectUserDisplay=createRuntimeDisplayProjector({regexScripts:displayScripts,placement:1,isMarkdown:true,isEdit:false,charName:chat.cardName,macroState:chat.macroState})
    const history = Array.isArray(chat.messages) ? chat.messages : []
    const nextAssistantTurns=[];let nextAssistantTurn=0
    for(let index=history.length-1;index>=0;index--){nextAssistantTurns[index]=nextAssistantTurn;if(history[index].role==='assistant')nextAssistantTurn=Number(history[index].turn)||0}
    const userRows=history.flatMap((message,index)=>{
      if(message.role!=='user')return []
      const turn=Number(message.turn)||nextAssistantTurns[index]||0
      return turn?[{turn,source:realUserText(message),depth:history.length-1-index}]:[]
    })
    const userDisplays=projectUserDisplay.many(userRows)
    for(const [index,row] of userRows.entries()){
      inputSources[row.turn]=row.source
      const projection=userDisplays[index]
      userProjections.push({turn:row.turn,text:projection.displayText,mode:projection.displayMode,parts:projection.displayParts})
    }
    const runtimeInputs = chat.runtimeInputs && typeof chat.runtimeInputs === 'object' ? chat.runtimeInputs : {}
    for (const turn of Object.keys(runtimeInputs)) {
      if (tavernTriggerTurnInput(nativeEvents, Number(turn))) continue
      const input = runtimeInputs[turn]
      inputSources[turn] = str(input && input.source)
      if (!userProjections.some(item => item.turn === Number(turn))) {
        const projection = projectUserDisplay(inputSources[turn],0)
        userProjections.push({ turn: Number(turn), text: projection.displayText, mode: projection.displayMode, parts: projection.displayParts })
      }
    }
    const currentCardDigest = cardContentDigest(card)
    const scriptResolution = resolveTavernScripts(chat, cardExtensions.helperScripts)
    const extensionScripts=await use(()=>extensionRuntime.scripts(chat.sessionId))
    const pinnedScripts = await use(()=>tavernRemoteAssets.pinExtensions({ helperScripts: [...extensionScripts,...cardOwnedScripts(scriptResolution.scripts)], regexScripts: [] }))
    const mvuSelection = selectMvuRuntime(pinnedScripts.helperScripts, { enabled: chat.mvu?.enabled === true })
    const helperEnabled = hasTavernScriptRuntime(chat, pinnedScripts.helperScripts)
    const helperRuntime = helperEnabled
      ? projectTavernHelperScripts(pinnedScripts.helperScripts, chat.tavernHelperScriptVariables)
      : { scripts: [], diagnostics: [] }
    // Capability seeds come from admitted sources, never the script's mutable
    // variables or metadata. Initial source data can itself declare dependencies.
    const sourceDataById = new Map(pinnedScripts.helperScripts.map(script=>[script.id,script.data]))
    const staticScriptSources = new Map(helperRuntime.scripts.map(script=>[script.id,{id:script.id,content:script.content,data:sourceDataById.get(script.id)}]))
    const preparedScriptSources=new Map([...staticScriptSources].map(([id,source])=>[id,frameResources.prepareSource(JSON.stringify(source))]))
    const scriptDigests = scriptAssets.publish(chat.sessionId, [scriptResolution.trees, ...helperRuntime.scripts.map(s => s.content)],['',...helperRuntime.scripts.map(s=>s.id)])
    await use(()=>scriptAssets.available(chat.sessionId,scriptDigests))
    const publishedScripts = helperRuntime.scripts.map((script, index) => ({ ...script, content: '', ...scriptAssets.describe(scriptDigests[index + 1]), sourceDigest: scriptDigests[index + 1] }))
    helperRuntime.diagnostics.push(...(Array.isArray(cardExtensions.remoteAssetDiagnostics) ? cardExtensions.remoteAssetDiagnostics : []))
    let helperWorldbook = null
    if (helperEnabled && str(chat.cardPath) !== '') {
      try {
        const record = await use(()=>worldBooks.boundCard(chat.cardPath, card, chat))
        if (record !== null) helperWorldbook = projectTavernHelperWorldbook(record.view)
      } catch (error) {
        helperRuntime.diagnostics.push({ scriptId: '', name: '世界书', status: 'unavailable', message: str(error && error.message || error) })
      }
    }
    const spState = await use(()=>extensionRuntime.installed()) && groupOfMode(chat.mode) === 'play' ? (chat.spDatabase || databaseState(chat)) : null
    const projectionEvents = await use(()=>sessionDebugEvidence(chat.sessionId).events)
    const suppressedDshTurns = foregroundSuppressedTurns(chat, projectionEvents)
    const runtimePolicy = {...await use(async()=>cardPermissions.read(await cardSecurityIdentity(chat)))}
    runtimePolicy.offline=await use(()=>outboundDisabled())
    if(runtimePolicy.offline){runtimePolicy.trustedCardMode=false;runtimePolicy.capabilities=runtimePolicy.capabilities.filter(value=>!['same-origin','network'].includes(value))}
    runtimePolicy.assetAccess = frameResources.publish({sessionId:chat.sessionId,cardPath:chat.cardPath,lifecycleRevision:Number(chat.tavernHelperLifecycleRevision || 0),scriptIds:helperRuntime.scripts.map(s=>s.id),networkTrusted:runtimePolicy.capabilities.includes('network')},JSON.stringify([card,[...staticScriptSources.values()],displayScripts.filter(script=>script.enabled!==false&&script.disabled!==true)]))
    await use(()=>frameResources.currentAccess(chat.sessionId))
    const result = {
      chatId: chat.id,
      contextCompaction: chat.contextCompaction || null,
      mode: chat.mode || 'story',
      requestMode: chat.requestMode === 'sillytavern' ? 'sillytavern' : 'dsh',
      playerName: str(chat.macroState && chat.macroState.userName).trim() || '你',
      userProfile: {
        enabled: chat.userProfileEnabled === true,
        revision: Math.max(0, Number(chat.userProfileRevision) || 0)
      },
      bypassPlan: null,
      runtimePreset: activePresetSnapshot === null ? null : { id: activePresetSnapshot.presetPath, name: activePresetSnapshot.presetName },
      templateEngine: ['story','script'].includes(chat.mode||'story')?await use(()=>templateEngineStatus(chat,{card,preset:activePresetSnapshot})):null,
      card: cardViewOf(card ? await use(()=>readCardWorkspace(chat.cardPath)) || card : card, chat),
      cardUpdate: await use(()=>playCardSnapshots.updateStatus(chat, card)),
      scriptLibraryUpdate:await use(()=>scriptLibrary.versionStatus(chat,scriptResolution.trees)),
      posture: chat.posture || '',
      ledger: readLedger(chat.ledger),
      characterDesigns: projectCharacterDesignDocument(chat.characterDesignDocument),
      characterDesignRemovalStamp: characterDesignRemovalStamp(chat),
      characterDesignTask: manualCharacterDesign ? manualCharacterDesign.project(chat, await use(()=>manualCharacterDesign.runtime(chat.id))) : (chat.characterDesignTask || { status: 'idle' }),
      phoneChat: await use(()=>phoneChat.project(chat, card)),
      guides: Array.isArray(chat.guides) ? chat.guides : [],
      debugTurns: debugTurns.slice(-12).reverse(),
      latestAssistantMessageId,
      nativeBodyMessageIds,
      nativeHistoryVisibility: projectNativeHistoryVisibility(liveSession, chat),
      forkTurnsByMessageId,
      latestAssistantTurn: latestStoryTurn,
      inputSources,
      userProjections,
      presetControls: gamePresetControls(chat),
      extensions:await use(()=>extensionRuntime.status()),
      spDatabase: spState ? { revision: spState.revision, maintenance: await use(()=>spDatabase.taskStatus(chat.id)) || spState.maintenance, activity: spState.activity, plotActivity: await use(()=>spDatabase.plotStatus(chat.id)), inspiration: spState.inspiration && { status: spState.inspiration.status, finishedAt: spState.inspiration.finishedAt } } : null,
      canRollback: hasRollbackMessages(chat.messages, nativeEvents) && !isRescuedHistoryMessage(chat, chat.messages?.findLast(m=>m.role==='assistant')),
      rescueNotice: chat.importHistory?.rescue ? chat.importHistory.warnings?.at(-1) || '' : '',
      presentation: null,
      replyProjections: replyDisplay.projections,
      tavernStatusView: replyDisplay.statusView || null,
      tavernStatusViews: replyDisplay.statusViews || [],
      mvuReceipts: mvuReceiptsOf(chat),
      tavernHelper: helperEnabled ? { ...projectTavernHelperContextReadonly(chat),scriptVariables:await use(()=>scriptVariablePolicy.effective(chat)),...await use(()=>tavernScriptDispatch.mvuActivity(chat)),assetAccess:runtimePolicy.assetAccess,helperPresetRevision:[chat.helperPresetRevision||0,chat.presetControls?.version||0,chat.playConfigRevision||0].join(":"), helperAudio:await use(()=>helperAudio.snapshot(chat)), worldbookLibrary:await use(()=>helperWorldbooks.catalog(chat)), presetVariables:await use(()=>helperPresetVariables.read(chat)), openingHost: sessionOpeningDescriptor(chat, card), proxyPresetNames: await use(()=>llm.listProviders().map(p => p.id)), scriptStorage: await use(async()=>({...await scriptServices.storageSnapshot(helperRuntime.scripts.map(s => s.id),chat,{readonly:true}),...await scriptServices.messageStorageSnapshot(chat,{readonly:true})})), scriptTreesDigest: scriptDigests[0], scriptTreeRevision: Number(chat.tavernScriptTreeRevision || 0), scriptMetadata: chat.tavernScriptMetadata || {}, database: spState ? scriptDatabaseSnapshot(spState) : null, worldbook: helperWorldbook, globalVariables: await use(()=>readPromptTemplateGlobalVariables(chat)), characterVariables: cardExtensions.variables || {}, compatibilityCapabilities: TAVERN_COMPATIBILITY_CAPABILITIES, extensionSettingsProtocol:2, extensionSettings: await use(()=>tavernExtensionSettings.readReadonly()), regexScripts: { global: cardExtensions.globalRegexScripts || [], preset:activePresetSnapshot?.regexScripts||[], character: cardExtensions.characterRegexScripts || [] } } : null,
      tavernMvuRuntime: mvuSelection,
      tavernMvuSettlementPaused: chat.mvu?.enabled === true && chat.mvu.settlementPaused ? { at: Number(chat.mvu.settlementPaused.at) || 0, reason: str(chat.mvu.settlementPaused.reason) } : null,
      suppressedDshTurns,
      regeneratedDshTurns: Object.fromEntries(Object.entries(chat.regeneratedDshTurns && typeof chat.regeneratedDshTurns === 'object' && !Array.isArray(chat.regeneratedDshTurns)
        ? { ...chat.regeneratedDshTurns, ...authoredTurnMappings(liveSession) } : authoredTurnMappings(liveSession)).map(function ([turn, visibleTurn]) { return [String(Number(turn)), Number(visibleTurn)] })
        .filter(function ([turn, visibleTurn]) { return Number.isSafeInteger(Number(turn)) && Number(turn) > 0 && Number.isSafeInteger(visibleTurn) && visibleTurn > 0 })),
      suppressedDshErrorTurns: supersededRegenerationErrorTurns({
        events: projectionEvents,
        suppressedDshTurns: chat.suppressedDshTurns
      }),
      tavernHelperScripts: publishedScripts,
      tavernHelperScriptDiagnostics: helperRuntime.diagnostics.concat(scriptResolution.diagnostics,tavernSourceDiagnostics(projectionEvents)),
      tavernRemoteAssetPins: Array.isArray(cardExtensions.remoteAssetPins) ? cardExtensions.remoteAssetPins : [],
      tavernHelperWorldbook: helperWorldbook,
      tavernRuntimePolicy: { ...runtimePolicy, scriptPolicies:Object.fromEntries(await use(()=>Promise.all(helperRuntime.scripts.map(async script=>{
        const policy={...runtimePolicy,...await scriptPolicy(chat,script.id)}
        if(runtimePolicy.offline){policy.trustedCardMode=false;policy.capabilities=policy.capabilities.filter(value=>!['same-origin','network'].includes(value))}
        policy.assetAccess=frameResources.publish({sessionId:chat.sessionId,ownerId:script.id,cardPath:chat.cardPath,lifecycleRevision:Number(chat.tavernHelperLifecycleRevision||0),scriptIds:[script.id],networkTrusted:policy.capabilities.includes('network')},preparedScriptSources.get(script.id))
        return [script.id,policy]
      })))) },
      releaseCapabilities: TAVERN_RELEASE_CAPABILITIES,
      sceneImagesEnabled: TAVERN_RELEASE_CAPABILITIES.sceneImages && (await use(()=>profileData.readReadonly('scene-images/settings.json')))?.enabled===true,
      sceneImagesPresent: TAVERN_RELEASE_CAPABILITIES.sceneImages && await use(()=>sceneIllustrations.hasRecords(chat.id)),
      presentationWarnings: (Array.isArray(chat.presentationWarnings) ? chat.presentationWarnings : []).concat(
        chat.importHistory?.contextPreparation?.status === 'trimmed'
          ? ['导入记录较长：已保留开头和最近完整轮次，中间 ' + chat.importHistory.contextPreparation.droppedRounds + ' 轮暂不随模型请求发送，历史正文仍可召回。'] : []),
      worldBookError: chat.worldBookError || null,
      foregroundError: chat.foregroundError || null,
      modelOutputNotice: chat.modelOutputNotice || null,
      lastWorldBookRecall: chat.lastWorldBookRecall || null,
      activity,
      settleStatus: activity.role === 'settlement' && ['pending', 'running'].includes(activity.phase) ? activity.phase : (activity.phase === 'failed' && activity.role === 'settlement' ? 'error' : (['pending', 'running', 'waiting-runtime'].includes(chat.settleStatus) ? chat.settleStatus : 'done')),
      settleError: recoveryFailure.message || (activity.reason === 'interrupted' ? '后台结算已中断，请重试结算。' : (chat.settleError || null)),
      settlementTurn: settlementTurn(chat),
      scriptProgress: scriptProgress,
      updatedAt: chat.updatedAt || 0
    }
    result.resourceRestrictions=projectPermissionDenials(await use(()=>permissionDenials.read(chat.sessionId)),{scripts:helperRuntime.scripts,cardPolicy:runtimePolicy,scriptPolicies:result.tavernRuntimePolicy.scriptPolicies})
    if(result.tavernHelper)result.tavernHelper.contextRevision=createHash('sha256').update(JSON.stringify([result.tavernHelper,result.card,result.tavernHelperWorldbook,result.tavernHelperScripts])).digest('hex')
    rememberOriginalSpUnloadScope(chat,unloadIdentity,unloadPackageDigest,unloadExtensionRevision,publishedScripts,extensionScripts,mvuSelection)
    return result
    })
  }
  function replyProjectionsOf(chat) {
    const messages = Array.isArray(chat && chat.messages) ? chat.messages : []
    const projections = []
    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index]
      if (!message || message.role !== 'assistant') continue
      const displayText = Object.prototype.hasOwnProperty.call(message, 'displayText') ? str(message.displayText) : str(message.text)
      const mode = str(message.displayMode) || 'markdown'
      if (displayText === str(message.text) && mode !== 'html' && mode !== 'rich') continue
      const turn = Math.max(0, Number(message.turn) || (message.greeting === true ? 1 : 0))
      if (turn === 0) continue
      projections.push({
        version: Math.max(1, Number(message.projectionVersion) || 1),
        turn,
        text: displayText,
        mode,
        warnings: Array.isArray(message.projectionWarnings) ? message.projectionWarnings : []
      })
    }
    return projections
  }
  function mvuReceiptsOf(chat) {
    const messages = Array.isArray(chat && chat.messages) ? chat.messages : []
    const receipts = []
    const activity = backgroundTasks.activity(chat)
    const latest = messages.findLast(function (message) { return message && message.role === 'assistant' })
    for (const message of messages) {
      if (!message || message.role !== 'assistant' || !message.mvu) continue
      const turn = Math.max(0, Number(message.turn) || (message.greeting === true ? 1 : 0))
      if (turn === 0) continue
      const stored = message.mvu.receipt
      const diagnostics = Array.isArray(message.mvu.diagnostics) ? message.mvu.diagnostics : []
      const receipt = stored && typeof stored === 'object' ? structuredClone(stored) : {
        version: 1,
        status: message.mvu.pending === true ? 'pending' : (diagnostics.length > 0 ? 'error' : (message.mvu.modified === true ? 'updated' : 'unchanged')),
        summary: '',
        changes: [],
        failures: diagnostics.map(function (item) { return { command: str(item.command), message: str(item.message) } })
      }
      if (message === latest && activity.reason === 'interrupted' && activity.role === 'settlement') {
        receipt.status = 'interrupted'
        receipt.summary = '后台结算因服务重启或异常退出而中断，请重试结算；正文和已保存变量保留。'
      }
      receipts.push({ turn, receipt })
    }
    return receipts
  }
  function withLegacyPresentationProjection(chat, projections) {
    const result = Array.isArray(projections) ? projections.slice() : []
    const legacy = chat && chat.presentation
    if (!legacy || typeof legacy !== 'object' || str(legacy.html) === '') return result
    const turn = Math.max(1, Number(legacy.turn) || (legacy.source === 'opening' ? 1 : 0))
    if (result.some(function (projection) { return Number(projection.turn) === turn })) return result
    const messages = Array.isArray(chat.messages) ? chat.messages : []
    let target = null
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (!message || message.role !== 'assistant' || Object.prototype.hasOwnProperty.call(message, 'sourceText')) continue
      const messageTurn = Math.max(0, Number(message.turn) || (message.greeting === true ? 1 : 0))
      if (messageTurn === turn || (turn > 1 && target === null)) target = message
      if (messageTurn === turn) break
    }
    if (target === null) return result
    const projected = projectRuntimeReply(str(target.text) + '\n\n' + str(legacy.html))
    result.push({
      version: 2,
      turn,
      text: projected.displayText,
      mode: projected.displayMode,
      parts: projected.displayParts,
      warnings: ['旧会话兼容：正文与历史人物卡界面已在原消息位置合并显示。'].concat(projected.warnings)
    })
    return result.sort(function (left, right) { return Number(left.turn) - Number(right.turn) })
  }
  async function startChat(cardPath, sessionId, mode, openingId, userName, requestMode, preparationId, cardTask, foregroundModel) {
    // Plain greetings have no interactive preview draft, but need the same
    // game-local worldbook snapshot as scripted openings.
    const implicitPreparation = !preparationId
    if (!preparationId && groupOfMode(mode || 'story') === 'play') {
      preparationId = (await openingPreparation.create(cardPath, { userName })).id
    }
    const finishPreparation = preparationId ? openingPreparation.acquire(preparationId) : () => {}
    let started = false
    try {
    const preparation = preparationId ? openingPreparation.resolve(preparationId, cardPath, openingId) : undefined
    if (preparation?.sourceSessionId) {
      const source = await chatForSession(preparation.sourceSessionId)
      if (!source || !sessionOpeningDescriptor(source, await readChatCard(source)) || Number(source.tavernHelperLifecycleRevision || 0) !== preparation.sourceLifecycleRevision) throw new Error('原对话已变化，请重新选择开场')
    }
    const result = await conversationInitialization.start({ cardPath, sessionId, mode, openingId, userName, requestMode, preparation, cardTask, foregroundModel })
    started = true
    return result
    } finally { finishPreparation(started || implicitPreparation) }
  }

  async function scriptPreviewOf(chat) {
    if ((chat.mode || 'story') !== 'script') return null
    const script = await readScript(chat.cardPath)
    if (script === undefined || !Array.isArray(script.chunks)) return null
    return scriptContinuity.inspect({ script: script, state: chat.scriptState, request: { kind: 'preview' } })
  }
  const sessionReadQueries=createSessionReadQueries({links:()=>conversationRegistry.links(),records:spStorage,readFull:chatForSessionReadonly,coordinator:{activity:input=>backgroundTasks.activity(input),operation:(input,id)=>backgroundTasks.operation(input,id)},upgradeReceipt:nativeUpgradeReceipt})
  async function sessionActivity(sessionId) {
    const result=await sessionReadQueries.activity(sessionId)
    if (!result) return null
    const activity = result.value
    return {
      chatId: result.chatId,
      phase: activity.phase,
      busy: activity.busy,
      role: activity.role,
      operationId: activity.operationId,
      basedOn: activity.basedOn,
      updatedAt: activity.updatedAt || result.updatedAt || 0
    }
  }
  async function sessionOperation(sessionId, operationId) {
    const result=await sessionReadQueries.operation(sessionId,operationId)
    if (!result) return null
    const operation = result.value
    if (operation === null || operation.role !== 'candidate' || operation.successful !== true) return operation
    const candidates = await candidateGenerator.find({ sessionId, messageId: result.candidateMessageId })
    if (candidates === null || candidates.operationId !== operation.operationId || candidates.requestId !== operation.requestId) return operation
    return Object.assign({}, operation, { result: { candidates } })
  }
  async function sessionView(sessionId) {
    await gameResourceBindings.refresh(sessionId)
    const chat = await chatForSessionReadonly(sessionId)
    if (chat === undefined) return null
    const isCard = (chat.mode || 'story') === 'card'
    let card = null, cardReadError = null
    try { card = isCard && str(chat.cardPath) === '' ? null : await readChatCard(chat) }
    catch (error) {
      if (!isCard) throw error
      cardReadError = '人物卡暂时无法读取，请在工作台校验并修复：' + chat.cardPath
      card = { name: chat.cardName || chat.cardPath }
    }
    const base = await view(chat, card)
    const extra = {runtimeNotice:runtimeNotices.get(sessionId)}
    if (cardReadError) extra.cardReadError = cardReadError
    if (isCard) extra.workspace = workspaceViewOf(chat)
    if ((chat.mode || 'story') === 'script') extra.scriptPreview = await scriptPreviewOf(chat)
    return sessionViewCache.read(sessionId,[base,extra],async()=>({...base,...extra}))
  }
  async function ensureNativeOpening(sessionId) {
    return await conversationInitialization.ensureOpening(sessionId)
  }
  const contextPlanner = createContextPlanner({ prompt: runtimePrompt, callModel: callModel, now: Date.now, logger: console })
  const playCardSnapshots = createPlayCardSnapshots({readCardScripts:async chat=>(await readCardExtensions(chat.cardPath))?.helperScripts||[], worldBooks, planner: contextPlanner, readCard: readChatCard, writeChat, captureSceneWorldbook, userPreferenceProfile })
  const resourceVersionPanel=createResourceVersionPanel({adapter:createResourceVersionAdapter({chats:{forSession:chatForSessionReadonly,update:updateChat},store:profileData,presets:presetLibrary,scriptLibrary,worldbookPublication:privateWorldbookPublication,playCardSnapshots,readCard:readChatCard,withSourceLock:(path,work)=>path?fileResources.withEditLock(path,work):work(),isBusy:chat=>{try{assertConversationIdle(chat);return false}catch{return true}}})})
  const ensurePlayCardSnapshot = playCardSnapshots.ensure
  async function ensureNativeSystemPrefix(session, chat) {
    const before = readSessionStablePrefix(session)
    const revision = Number(chat.cardContextRevision) || 0
    const text = before?.version === 3 && revision <= Number(before.message.source.cardContextRevision || 0) ? '' : await ensurePlayCardSnapshot(chat)
    const prefix = await ensureSessionStablePrefix(session, text, stablePrefixStorage, revision)
    if (prefix && prefix.event !== before?.event) await sessionStore.flush(session)
    return prefix
  }
  async function ensureNativeCardWorkspace(session, chat) {
    const projection = await publishResourceWorkspace(session.id, chat)
    const text = resourceWorkspaceContext(session.header?.cwd, projection, runtimePrompt('card-workspace'))
    const message = ensureCardWorkspaceMessage(session, text)
    await sessionStore.flush(session)
    return message.data.content[0].text
  }
  const conversationInitialization = createConversationInitialization({
    promptLimits: capacityLimits.prompts,
    cards: { read: readCard, readChat: readChatCard, script: readScript, extensions: readCardExtensions },
    chats: { resolve: chatForSession, publish: conversationRegistry.publish, write: writeChat },
    timeline: storyTimeline,
    snapshots: playCardSnapshots,
    prepareOpening: async chat => {
      if(!chat.messages.length || !await fullTemplateEnabled(chat,{texts:[chat.messages.at(-1).sourceText??chat.messages.at(-1).text]}))return chat
      const staged=await fullTemplateCommitter.prepare({chat,reply:{sourceText:chat.messages.at(-1).sourceText},
        envelope:await tavernScriptHostAdapter.readFullPromptTemplateState(chat.sessionId,chat),serviceContext:await fullTemplateServiceContext(chat.sessionId,chat)})
      staged.chat.openingText=staged.reply.sessionText
      staged.chat.fullPromptTemplateOpening={version:1,processed:true}
      return staged.chat
    },
    flushOpeningEffects: async chat => {
      if(!chat.fullPromptTemplateEffects?.length)return null
      await fullTemplateCommitter.flush(chat.sessionId)
      return chatForSession(chat.sessionId)
    },
    userPreferenceProfile,
    presets: runtimePresets,
    settings: readTavernSettings,
    emptyCardWorkspace,
    id: uid,
    native: {
      wait: function (sessionId) { return waitForWritableSession({ registry: agentRegistry, sessions: sessionStore, sessionId, sleep }) },
      ensurePrefix: function (session, text) { return ensureSessionStablePrefix(session, text, stablePrefixStorage) },
      ensureCardWorkspace: ensureNativeCardWorkspace,
      flush: function (session) { return sessionStore.flush(session) },
      selection: modelSelection,
      selectModel: async (target,selection) => {const resolved=await llm.resolveCallConfig(selection);const agent=target.agent || agentRegistry.get(target.session.id);ctx.get('sessionController').agents.selectForNextRequest(agent,{provider:resolved.provider,model:resolved.model,...(resolved.reasoningEffort?{reasoningEffort:resolved.reasoningEffort}:{})})}
    },
    present: async function (chat, card) {
      const result = await view(chat, card)
      return chat.mode === 'card' ? {...result, workspace:workspaceViewOf(chat)} : result
    }
  })
  const chatHistoryImportOptions = {
    isBusy: chat=>backgroundTasks.activity(chat).busy || agentRegistry.get(chat.sessionId)?.phase?.kind==='running',
    projectWorldBookTemplates: (chat,card)=>nativeWorldBookTemplateContext(chat,card,{importDraft:true}),
    worldBookRecallLimit: async () => (await readTavernSettings()).worldBookRecallLimit,
    planner: contextPlanner,
    initialization: conversationInitialization,
    cards: { read: readCard }, worldBooks, store: profileData,
    chats: { resolve: chatForSession, publish: conversationRegistry.publish, read: readChat, readRevision: readChatRevision, write: rawWriteChat },
    native: {
      wait: sessionId => waitForWritableSession({ registry: agentRegistry, sessions: sessionStore, sessionId, sleep }),
      ensurePrefix: (session, text) => ensureSessionStablePrefix(session, text, stablePrefixStorage),
      flush: session => sessionStore.flush(session)
    }
  }
  const chatHistoryImporter=createChatHistoryImportService(chatHistoryImportOptions)
  const helperChatImporter=createChatHistoryImportService({...chatHistoryImportOptions,prepareImportedChat:prepareTransferredChat})
  const helperChatTransfer=createTavernChatTransfer({store:profileData,chats:{findByName:conversationRegistry.findByName,forSession:chatForSession,read:readChat,update:updateChat,list:async()=>(await readIndex()).chats.map(c=>c.id)},importer:helperChatImporter,assertOwner:assertHelperOwner,isBusy:chat=>backgroundTasks.activity(chat).busy||Boolean(chat.regenInProgress)||agentRegistry.get(chat.sessionId)?.phase?.kind==='running',createSession:async(sessionId)=>{if(!await sessionStore.get(sessionId))await ctx.get('sessionController').create({sessionId,agentPreset:'tavern'})}})
  const gamePackageResources=createGamePackageResources({assets:createGamePackageAssets({store:profileData,cache:tavernStaticResources,pins:tavernRemoteAssets,attachments:()=>ctx.get('attachments')}),store:profileData,files:fileResources,identities:resourceIdentities,worldBooks,readCard:readChatCard,readScripts:effectiveHelperScripts,
    installExtension:async(pkg,{ifMissing})=>{const current=extensionRuntime.status();if(ifMissing&&!current.installed){await extensionRuntime.change({kind:'install',package:pkg},current.revision);await originalSpCatalog.initialize()}},
    trust:async chat=>{const identity=await cardSecurityIdentity(chat);await cardPermissions.change(identity,identity.digest,COMPATIBILITY_CAPABILITIES);if(chat.runtimePresetPath)await cardPermissions.changeResource('preset',chat.runtimePresetPath,COMPATIBILITY_CAPABILITIES);for(const script of Object.values(chat.tavernScriptTrees||{}).flatMap(rows=>flattenScriptTrees(rows)))if(script._dshResourceId)await cardPermissions.changeResource('script',script._dshResourceId,COMPATIBILITY_CAPABILITIES)}
  })
  const gamePackages=createGamePackageService({store:profileData,resources:gamePackageResources,native:createGamePackageNative({sessions:sessionStore,persistence:ctx.get('sessionPersistence'),agents:agentRegistry,cwd:()=>dataRoot+'/resources',workspaces:()=>ctx.get('workspaceRegistry')}),
    chats:{forSession:chatForSession,read:readChat,readRevision:readChatRevision,write:async(chat,metadata)=>{chat._storageRevision=(await readChat(chat.id))?._storageRevision||0;return rawWriteChat(chat,metadata)},publish:async chat=>{chat._storageRevision=(await readChat(chat.id))?._storageRevision||0;return conversationRegistry.publish(chat)}},
    isBusy:chat=>!chat||backgroundTasks.activity(chat).busy||Boolean(chat.regenInProgress)||agentRegistry.get(chat.sessionId)?.phase?.kind==='running'
  })
  const gamePackageTransfer=createGamePackageTransfer({root:dataRoot+'/cache/game-package-transfers',packages:gamePackages})
  ctx.effect(()=>()=>gamePackageTransfer.dispose())
  const scriptNavigation=createScriptNavigation({chats:{forSession:chatForSession,update:updateChat},readScript,scripts:scriptContinuity,
    isBusy:chat=>backgroundTasks.activity(chat).busy||Boolean(chat.regenInProgress)||agentRegistry.get(chat.sessionId)?.phase?.kind==='running',
    exclusive:(id,work)=>backgroundTasks.exclusive(id,work)})
  async function prepareConversationFork(sourceChatId, sourceSessionId, requestedTurn) {
    const source = str(sourceChatId) === '' ? await chatForSession(str(sourceSessionId)) : await readChat(str(sourceChatId))
    if (!source) throw new Error('找不到要分叉的源对话')
    assertConversationForkable(source, { agentRunning: agentRegistry.get(source.sessionId)?.phase?.kind === 'running' })
    const { state, turn } = await conversationStateAtTurn(source, requestedTurn, readChatRevision)
    let handle
    let session = sessionStore.get(source.sessionId) || agentRegistry.get(source.sessionId)?.session
    if (!session) { handle = await agentRegistry.resume({ resumeSessionId: source.sessionId }); session = handle.agent.session }
    try {
      return { source, state, turn, atSeq: conversationForkBoundary(session, state, turn, source) }
    } finally { if (handle) await handle.dispose() }
  }
  async function forkChat(sourceChatId, sourceSessionId, targetSessionId, requestedTurn, expectedRevision, expectedAtSeq) {
    const { source, state, turn, atSeq } = await prepareConversationFork(sourceChatId, sourceSessionId, requestedTurn)
    if (expectedRevision !== source._storageRevision || expectedAtSeq !== atSeq) throw new Error('源对话已变化，请重新选择分叉回合')
    const targetId = str(targetSessionId)
    if (targetId === '' || await chatForSession(targetId) !== undefined) throw new Error('分叉目标必须是尚未绑定对话的新 Session')
    const target = sessionStore.get(targetId) || agentRegistry.get(targetId)?.session
    const targetEnd = sessionEvents(target).findLast(event => event.type === 'turn/end')
    if (!targetEnd || targetEnd.seq !== atSeq) throw new Error('原生分叉没有停在指定回合，已拒绝绑定游戏状态')
    const fork = forkConversationChat(state, { chatId: uid('chat'), sessionId: targetId, id: uid, now: Date.now })
    fork.forkedFrom = { ...fork.forkedFrom, chatId: source.id, sessionId: source.sessionId, storageRevision: source._storageRevision,
      stateChatId: state.id, stateRevision: state._storageRevision, turn, atSeq }
    await conversationRegistry.publish(fork)
    return conversationForkReceipt(fork, { lastTurn: turn, messageCount: fork.messages.length })
  }

  const runtimePresetSnapshots = new Map()
  const backgroundRetirement=createBackgroundSessionRetirement(profileData,{
    readState:chatForSessionReadonly,
    native:createNativeBackgroundRetirement({sessions:sessionStore,persistence:ctx.get('sessionPersistence'),agents:agentRegistry}),
    isRunning:id=>{const phase=agentRegistry.get(id)?.phase;return Boolean(phase && phase.kind!=='idle')}
  })
  ctx.effect(()=>()=>backgroundRetirement.dispose(),'dsh-tavern: retired background maintenance')
  ctx.effect(()=>installRetiredBackgroundFilter(ctx.get('subagents'),backgroundRetirement,ctx.get('sessionQuery')),'dsh-tavern: retired background discovery')
  const backgroundAgentRunner = createBackgroundAgentRunner({
    retirement:backgroundRetirement,
    systemAppend: () => runtimePrompt('system-append'),
    resolveWebSearch: async input => (await chatForSessionReadonly(input.sessionId))?.webSearchEnabled === true,
    // The 设计人物 button designs characters whatever the game's switch says (87c4b25a).
    resolveBackgroundTasks: async input => { const tasks = playRuntimeSettings(await chatForSessionReadonly(input.sessionId),await readTavernSettings()).backgroundTasks; return input.task === 'character-design' ? { ...tasks, characterDesign: true } : tasks },
    backgroundTools: [POSTURE_SUBMIT_TOOL, LEDGER_SUBMIT_TOOL,CHARACTER_DESIGN_READ_TOOL, CHARACTER_DESIGN_SAVE_TOOL, MVU_SUBMIT_UPDATE_TOOL, CANDIDATE_SUBMIT_TOOL, SCRIPT_READ_TOOL, SCRIPT_POINT_TOOL],
    sharedTools: [{
      tool: HISTORY_RECALL_TOOL,
      async execute({ input, args }) {
        return renderHistoryRecall(await recallHistoryForSession(input.sessionId, args))
      }
    }, sharedWorldbookSearch(searchWorldbook)],
    stablePrefixStorage,
    agents: agentRegistry,
    agentPreset: 'tavern-background',
    needsNewBackgroundSession: async sessionId => {
      const chat = await chatForSessionReadonly(sessionId)
      return chat?.timeline?.participants?.background?.status === 'needs-session'
    },
    resolveCurrentWorldbook: async function (input) {
      if (input.task === 'image') return undefined
      const chat = await chatForSession(input.sessionId)
      return chat ? (await nativeWorldBookTemplateContext(chat, await readChatCard(chat))).context : undefined
    },
    resolveStablePrefixRevision: async input => Number(await sessionReadQueries.value(input.sessionId,'/cardContextRevision')) || 0,
    resolveStablePrefix: async function (input) {
      // Image tasks share the opening snapshot; current-worldbook replacement stays disabled above
      // because a requested illustration may target an earlier story turn.
      const chat = await chatForSession(input.sessionId)
      return chat ? await ensurePlayCardSnapshot(chat) : ''
    },
    setupAgent: async function (childCtx) {
      await agentPresets.mount(childCtx, 'tavern-background')
    },
    compactAgent: executeBackgroundCompaction,
    flushSession: async function (session) {
      const sessions = ctx.get('sessions')
      if (sessions === undefined) throw new Error('dsh-tavern: 缺少 sessions 服务')
      return await sessions.flush(session)
    },
    resolveRuntimePresetSnapshot: async function (input) {
      // 外部 Tavern 预设只投影到前台正文请求。后台 Agent 有自己的结构化任务协议，
      // 继承整份预设可能破坏候选生成和状态结算的输出契约。
      return null
    },
    stageRuntimePresetSnapshot: function (input) {
      runtimePresetSnapshots.set(str(input.sessionId), {
        turn: Math.max(0, Number(input.turn) || 0),
        step: Math.max(1, Number(input.step) || 1),
        scope: 'background',
        snapshot: input.snapshot || null
      })
    }
  })
  installCompactionRequestProjection(ctx,async id=>Boolean(await chatForSessionReadonly(id))||backgroundAgentRunner.owns(id))
  const characterDesignDocuments = createCharacterDesignDocumentTools({
    store: { readChat, updateChat },
    now: Date.now,
    // 87c4b25a (user 2026-10-09): both the switch path and the 设计人物 button save through here.
    writeWorldbook: async (chat, character) => writeCharacterDesignWorldbook({ worldBooks, chat, card: await readChatCard(chat), character }),
    describeWorldbook: characterDesignWorldbookNote
  })
  const phoneChat = createPhoneChat({
    store: { chatForSession, readCard, updateChat },
    isBusy: chat => Boolean(chat.regenInProgress) || ['pending', 'running'].includes(chat.settleStatus) || backgroundTasks.activity(chat).busy || agentRegistry.get(chat.sessionId)?.phase?.kind === 'running',
    runAgent: function (input) { return backgroundAgentRunner.run(input) },
    selection: backgroundModelSelection,
    now: Date.now,
    id: function () { return uid('phone-message') }
  })
  const mvuSettlement = createMvuSettlementModule({
    model: backgroundAgentRunner,
    runtime: tavernScriptHostAdapter,
    diagnostics: mvuDiagnostics,
    characterDesign: characterDesignDocuments
  })
  ctx.effect(() => () => backgroundAgentRunner.dispose(), 'dsh-tavern: dispose resident background agents')
  const sceneIllustrations = TAVERN_RELEASE_CAPABILITIES.sceneImages ? createSceneIllustrations({
    onDiagnostic: imageHostDiagnostic,
    readLegacyConfiguration: legacyImageConfigurationReader(ctx.get('settings')?.documentPath),
    store: profileData, dataRoot, diagnostics: sceneDiagnostics, chatForSession, selection: modelSelection,
    worldbookAtTarget: async (chat, target) => {
      try { return await sceneWorldbooks.read(sceneWorldbookBinding(chat, target)) }
      catch (_error) { return { unavailable: '历史世界书快照读取失败，未读取当前世界书。' } }
    },
    isRunning: sessionId => ctx.get('agents')?.get(sessionId)?.phase?.kind === 'running',
    stateAtTarget: async (chat, target) => {
      // The next turn's beforeRevision contains the settled state of this turn.
      const next = (chat.timeline?.checkpoints || []).find(item => Number(item.turn) > target.turn && Number.isSafeInteger(item.beforeRevision))
      if (!next) return undefined
      const historical = await readChatRevision(chat.id, next.beforeRevision)
      if (!historical) return undefined
      const last = [...(historical.messages || [])].reverse().find(item => item.role === 'assistant')
      const lastTurn = Number(last?.turn || (last?.greeting ? 1 : 0))
      if (lastTurn !== target.turn || historical.settleStatus !== 'done') return undefined
      const original = sceneTarget(historical, target.turn)
      return original.key === target.key ? historical : undefined
    },
    credentials: () => ctx.get('credentials'), attachments: () => ctx.get('attachments'),
    runAgent: input => backgroundAgentRunner.run(input),
    onStorageError: () => console.error('dsh-tavern: 生图状态保存失败，请检查数据目录权限')
  }) : null
  if (sceneIllustrations !== null) ctx.effect(() => () => sceneIllustrations.dispose(), 'dsh-tavern: dispose scene image agents')
  function enabledSceneIllustrations() {
    if (sceneIllustrations === null) throw new Error('当前版本未开放场景生图')
    return sceneIllustrations
  }
  let tavernCompaction = null
  const backgroundTasks = createBackgroundTaskCoordinator({
    store: { readChat, writeChat, updateChat },
    timeline: storyTimeline,
    blocked: function (chat) { return Boolean(chat.nativeHistoryEdit) || (tavernCompaction !== null && tavernCompaction.blocked(chat)) || Boolean(autoCompaction?.blocked(chat)) }
  })
  // 87c4b25a (user 2026-10-09): the 设计人物 button, next to the per-game switch.
  manualCharacterDesign = createManualCharacterDesign({
    store: { chatForSession, updateChat, readCard: readChatCard },
    tasks: backgroundTasks,
    runAgent: input => backgroundAgentRunner.run(input),
    selection: backgroundModelSelection,
    designs: characterDesignDocuments,
    removeWorldbook: async (chat, name) => removeCharacterDesignWorldbook({ worldBooks, chat, card: await readChatCard(chat), name }),
    // Upstream ef5ec5b5: restore the game's foreground agent first when it is not live.
    ensureSession: async sessionId => { if (!agentRegistry.get(sessionId)?.session) await resolveForegroundAgent(sessionId) },
    assertIdle: chat => assertConversationIdle(chat)
  })
  tavernCompaction = createTavernCompactionCoordinator({
    store: { chatForSession, updateChat },
    activity: function (chat) { return backgroundTasks.activity(chat) },
    now: Date.now
  })
  async function compactBackground(sessionId, operationId) {
    const backgroundSessionId = await tavernCompaction.backgroundTarget(sessionId, operationId)
    if (backgroundSessionId === '') return { status: 'skipped', message: '没有后台 Session' }
    try {
      const result = await backgroundAgentRunner.compact({ sessionId: backgroundSessionId })
      if (result === null) return { status: 'succeeded', message: '没有可压缩的后台历史' }
      if (typeof result.message === 'string' && result.message !== '') {
        return { status: 'succeeded', message: result.message }
      }
      return {
        status: 'succeeded',
        message: 'Compacted ' + result.shadowedSeqs.length + ' history items (~' + result.shadowedTokenCount + ' tokens).'
      }
    } catch (error) {
      return { status: 'failed', message: str(error && error.message || error) || '后台压缩失败' }
    }
  }
  const configuredCompactionEngines = new WeakSet()
  const pendingCompactionMessages = new WeakMap()
  const compactionDisposers = []
  ctx.effect(() => () => { for (const dispose of compactionDisposers) dispose() })
  const agentCompaction = agent => resolveAgentCompaction(ctx, agent)
  async function resolveForegroundAgent(id) {
    await profileSessionAccess.foreground(id)
    const controller = ctx.get('sessionController')
    if (!controller?.resolveAgent) throw new Error('前台会话控制器尚未就绪')
    const result = await controller.resolveAgent(id)
    if (result?.error) throw result.error
    if (!result?.agent) throw new Error('前台会话未能恢复')
    return result.agent
  }
  const overflowingCompactions = new Set()
  // Rounds kept verbatim after a story summary, bounded by a share of the model window. (upstream 377f70cf)
  async function storyRetention({ sessionId, provider, model, signal }) {
    // Provider-confirmed overflow must shrink as far as possible; it keeps no extra rounds.
    const rounds = overflowingCompactions.has(sessionId) ? 0 : (await readTavernSettings()).contextCompaction.retainRounds
    const info = provider && model ? await Promise.resolve(ctx.llm.resolveModelInfo?.(provider, model, signal)).catch(() => undefined) : undefined
    const window = info?.context?.contextWindow
    const meter = ctx.get('tokenMeter')
    return {
      rounds,
      budget: Number.isFinite(window) && window > 0 ? Math.floor(window * RETAINED_ROUNDS_WINDOW_SHARE) : Infinity,
      estimate: text => meter?.estimateMessage ? meter.estimateMessage({ role: 'user', content: [{ type: 'text', text }] }) : Math.ceil(text.length / 4)
    }
  }
  async function withCompactionSession(id, work) {
    const chat = await chatForSessionReadonly(id)
    if (chat?.sessionId === id) return work(await resolveForegroundAgent(id))
    const live = agentRegistry.get(id)
    if (live) return work(live)
    const handle = await agentRegistry.resume({ resumeSessionId: id })
    try { return await work(handle.agent) } finally { await handle.dispose() }
  }
  autoCompaction = createAutoCompaction({
    readChat: chatForSession, updateChat,
    policy: async () => (await readTavernSettings()).contextCompaction,
    activity: chat => backgroundTasks.activity(chat),
    exclusive: backgroundTasks.exclusive,
    settle: chat => queueSettlement(chat.id),
    async pressure(agent, signal, pendingMessages = [], sessionId) {
      const measure = async agent => {
      let selected
      try { const state = ctx.get('sessionProjections')?.stateOf(agent.session, 'modelSelection'); selected = state?.pending || state?.lastUsed } catch {}
      const target = selected || agent.session.requestHeader()?.config
      if (!target?.provider || !target?.model) return null
      const info = await ctx.llm.resolveModelInfo(target.provider, target.model, signal)
      const capacity = info?.context?.contextWindow
      if (!Number.isFinite(capacity) || capacity <= 0) return null
      const meter = ctx.get('tokenMeter'), previous = agent.session.requestHeader()
      const envelope = previous ? { ...previous, config: { ...previous.config, ...target } } : undefined
      const pendingTokens = pendingMessages.reduce((sum, message) => sum + meter.estimateMessage(message), 0)
      return { percent: 100 * (meter.measure(agent.session, envelope).totalTokens + pendingTokens) / capacity }
      }
      return agent ? measure(agent) : sessionId ? withCompactionSession(sessionId, measure) : null
    },
    checkpoint: id => withCompactionSession(id, agent => agent.session.seq),
    recover: (id, before) => withCompactionSession(id, agent => {
      const events = sessionEvents(agent.session).filter(event => event.seq >= before)
      const summary = events.find(event => event.type === 'compaction/summary')
      const completed = summary && events.some(event => event.type === 'compaction/end' && event.data?.compactionId === summary.data.compactionId && !event.data?.error)
      const replaced = summary && events.some(event => event.type === 'user/message' && event.surfaceOp?.op === 'replace' && event.data?.source?.compactionId === summary.data.compactionId)
      return completed && replaced ? 'succeeded' : 'unknown'
    }),
    markBackground: (id, target) => updateChat(id, chat => {
      const participant = chat.timeline?.participants?.background
      if (participant?.sessionId === target) { participant.requiresNewSessionOnRewind = true; participant.compactionPlannedAt = Date.now() }
      return chat
    }, { source: 'compaction.background' }),
    async compact(id, side, options, signal) {
      if (side === 'background') return backgroundAgentRunner.compact({ sessionId: id, signal })
      // Kept rounds stay verbatim, so a history they cover entirely has nothing to summarize.
      const covered = async session => {
        const header = session.requestHeader?.()?.config
        const retention = await storyRetention({ sessionId: id, provider: header?.provider, model: header?.model, signal })
        return storyHistoryFullyRetained(session, retention.rounds, retention) ? retention.rounds : 0
      }
      const retained = options.agent ? await covered(options.agent.session) : await withCompactionSession(id, agent => covered(agent.session))
      if (retained) return { message: `最近 ${retained} 轮剧情保留原文，暂无更早的历史需要压缩` }
      if (options.openTurnCompact) return options.openTurnCompact()
      return withCompactionSession(id, async agent => (await agentCompaction(agent)).compactNow(agent, signal))
    }
  })
  async function configureAgentCompaction(agent) {
    const engine = await agentCompaction(agent)
    if (configuredCompactionEngines.has(engine)) return engine
    configuredCompactionEngines.add(engine)
    compactionDisposers.push(installCompactionPolicy(engine, async (target, trigger, signal, fallback, forced) => {
      const background = backgroundAgentRunner.requestContext(target.session.id)
      if (background && !['image', 'phone'].includes(background.task)) return null
      const chat = await chatForSession(target.session.id)
      if (!chat || !['story', 'script'].includes(chat.mode)) return fallback()
      const run = () => autoCompaction.run(target.session.id, { agent: target, signal, openTurnCompact: forced, pendingMessages: pendingCompactionMessages.get(target) || [] })
      if (trigger !== 'context-overflow') { await run(); return null }
      overflowingCompactions.add(target.session.id)
      try { await run() } finally { overflowingCompactions.delete(target.session.id) }
      return null
    }, { beforeRegion: async target => {
      const background = backgroundAgentRunner.requestContext(target.session.id)
      if (!background || ['image','phone'].includes(background.task)) return
      const chat = await chatForSession(background.parentSessionId)
      if (!chat) throw new Error('后台压缩找不到所属对话')
      await updateChat(chat.id, current => {
        const participant = current.timeline?.participants?.background
        if (participant?.sessionId !== target.session.id) throw new Error('后台会话已变更，取消旧会话压缩')
        participant.requiresNewSessionOnRewind = true; participant.compactionPlannedAt = Date.now()
        return current
      }, {source:'compaction.background'})
    } }))
    return engine
  }
  ctx.on('agent/pre-step', async (payload, next) => {
    const id = payload.agent.session.id, background = backgroundAgentRunner.requestContext(id)
    if(!background)await historyOperations.recover(id)
    const chat = background ? null : await chatForSession(id)
    if (background && ['image', 'phone'].includes(background.task)) return next()
    if (background || chat && ['story', 'script'].includes(chat.mode)) {
      const engine = await configureAgentCompaction(payload.agent)
      pendingCompactionMessages.set(payload.agent, payload.messages || [])
      try {
        await engine.compactIfNeeded(payload.agent, 'pressure', payload.signal)
        return await next()
      } finally { pendingCompactionMessages.delete(payload.agent) }
    }
    return next()
  }, { prepend: true })
  ctx.on('agent/status', ({ agent, status }) => { if (status === 'idle') queueAutoCompaction(agent.session.id) })
  const fullWorldbookCycles=createFullTemplateWorldbookCycles()
  async function nativeWorldBookTemplateContext(chat, card, {foreground=false,turn,importDraft=false}={}) {
    let worldBook
    try {
      worldBook = await worldBooks.bound(chat.cardPath, card, chat)
    } catch (error) {
      console.warn('dsh-tavern: 动态世界书读取失败，已跳过:', str(error && error.message || error))
      return { context: '', refs: [], diagnostics: [{ kind: 'worldbook-template', code: 'worldbook-read-failed' }] }
    }
    if (!worldBook || !worldBook.view) return { context: '', refs: [], diagnostics: [] }
    if (await fullTemplateEnabled(chat,{card,worldbook:worldBook})) {
      const entriesForTemplate=projectTemplateWorldbookEntries(worldBook)
      // Historical frames use an unpublished draft. Keep template writes local
      // to this projection: importing snapshots must not replay historical
      // effects into the chat, shared variables, or extension settings.
      let projectionChat=chat,projectionEnvelope,projectionContext
      const executeTemplate=async operation=>{
        if(!importDraft)return fullPromptTemplates.execute(chat.sessionId,operation)
        projectionEnvelope ||= await tavernScriptHostAdapter.readFullPromptTemplateState(chat.sessionId,chat)
        projectionContext ||= await fullTemplateServiceContext(chat.sessionId,chat)
        const staged=await fullTemplateCommitter.stage(projectionChat,operation,{envelope:projectionEnvelope,serviceContext:projectionContext})
        projectionChat=staged.chat
        projectionEnvelope={environment:staged.environment}
        return staged.result
      }
      const processEntries=()=>executeTemplate({kind:'worldbook',entries:entriesForTemplate})
      const nativeTurn=turn || sessionEvents(sessionStore.get(chat.sessionId) || agentRegistry.get(chat.sessionId)?.session).findLast(e=>e.type==='turn/start')?.data.turn || 0
      const processed=foreground ? await fullWorldbookCycles.run(chat.sessionId,{turn:nativeTurn,lifecycle:chat.tavernHelperLifecycleRevision,entries:entriesForTemplate},processEntries) : await processEntries()
      const entries = restoreTemplateWorldbookEntries(processed.entries).filter(entry => entry.enabled !== false && entry.constant === true && !/^\s*\[mvu_update\]/i.test(entry.comment || entry.title || ''))
      entries.sort((a,b) => (Number(b.order)||0)-(Number(a.order)||0) || (Number(a.displayIndex)||0)-(Number(b.displayIndex)||0))
      let context=entries.map(entry=>entry.content).filter(Boolean).join('\n\n')
      if(!foreground && context.includes('<%'))context=(await executeTemplate({kind:'evaluate',code:context})).text
      const projected=projectAgentContent(context,{charName:card?.name,macroState:chat.macroState,chatId:chat.id})
      return {context:projected.agentText,refs:entries.map(entry=>entry.ref),diagnostics:projected.diagnostics||[],evaluated:0,dynamicConstants:true,macroState:projected.macroState}
    }
    if(!await lightTemplateEnabled(chat,{card,worldbook:worldBook})){
      const constant=constantWorldBookContext({worldBook,includeTemplates:true}),projected=projectAgentContent(constant.context,{charName:card?.name,macroState:chat.macroState,chatId:chat.id})
      return {...constant,context:projected.agentText,diagnostics:projected.diagnostics||[],evaluated:0,dynamicConstants:true,macroState:projected.macroState}
    }
    try {
      return projectWorldBookTemplates({
        includeConstants: true,
        worldBook,
        runtime: await promptTemplateRuntime(),
        globalVariables: await readPromptTemplateGlobalVariables(chat),
                card,
        chat
      })
    } catch (error) {
      console.warn('dsh-tavern: 动态世界书解析失败，已跳过:', str(error && error.message || error))
      return { context: '', refs: [], diagnostics: [{ kind: 'worldbook-template', code: 'projection-failed' }] }
    }
  }
  const candidateGenerator = createCandidateGenerator({
    backgroundTasks: async chat => playRuntimeSettings(chat,await readTavernSettings()).backgroundTasks,
    store: {
      chatForSession: chatForSession,
      readChat: readChat,
      readCard: readCard,
      readCardExtensions: readCardExtensions,
      readScript: readScript,
      writeChat: writeChat
    },
    model: {
      selection: backgroundModelSelection,
      runCandidate: backgroundAgentRunner.run
    },
    planner: contextPlanner,
    stableWorldBookContext: async function (chat, card) {
      return (await nativeWorldBookTemplateContext(chat, card)).context
    },
    prompt: runtimePrompt,
    scripts: scriptContinuity,
    timeline: storyTimeline,
    tasks: backgroundTasks,
    characterDesign: characterDesignDocuments,
    waitUntilSettled: async function (chat) {
      let current = await readChat(chat.id)
      if (current === undefined) return
      let shouldRun = false
      if (isOpeningAwaitingSettlement(current)) {
        current.settleStatus = 'running'
        current.settleError = null
        await writeChat(current, { source: 'settlement.opening-prepare' })
        shouldRun = true
      }
      const activity = backgroundTasks.activity(current)
      if (activity.role === 'settlement' && (activity.phase === 'pending' || activity.phase === 'running')) shouldRun = true
      if (shouldRun) await queueSettlement(current.id)
    },
    sleep: sleep,
    now: Date.now,
    logger: console
  })
  const candidateTasks = createCandidateTasks({
    chats: { read: readChat, write: writeChat, forSession: chatForSession },
    generator: candidateGenerator,
    backgroundTasks,
    sessions: {
      runtimeGeneration,
      isLive: function (sessionId) { return Boolean(agentRegistry.get(sessionId)?.session) },
      projectionRevision: cardProjectionRevision
    },
    prepareLegacy: pullBackgroundCycle
  })
  const ledgerEditor = createLedgerEditor({
    chats: { forSession: chatForSession, update: updateChat }, timeline: storyTimeline,
    isBusy: chat => backgroundTasks.activity(chat).busy || Boolean(chat.regenInProgress) || agentRegistry.get(chat.sessionId)?.phase?.kind === 'running'
  })
  // Host-only read projection. Native discovery is the authority; Profile links
  // narrow its result without reading (or repairing) the possibly broken chat.
  async function getTavernBackgroundRetirementNotices(args = {}) {
    if (Object.keys(args).some(key => !['parentSessionId', '_performance'].includes(key))) {
      throw new Error('后台会话标注只能从宿主界面读取')
    }
    const parentId = args.parentSessionId
    if (parentId !== undefined && (typeof parentId !== 'string' || !parentId || parentId.length > 200)) {
      throw new Error('请指定当前 Profile 的有效父会话')
    }
    let records, owners
    try {
      owners = new Set((await conversationRegistry.list()).map(row => row.sessionId))
      if (parentId !== undefined && !owners.has(parentId)) throw new Error('not-owned')
      records = await ctx.get('sessionQuery').listSessions()
    } catch {
      // Storage paths and upstream authorization details do not belong in the UI.
      throw new Error('后台会话标注暂不可读取，请重新检查')
    }
    const byId = new Map(records.map(record => [record.header.id, record]))
    const roots = new Map()
    function rootOf(id) {
      const seen = new Set(), chain = []
      let current = id, root
      while (current && !seen.has(current) && byId.has(current)) {
        if (roots.has(current)) { root = roots.get(current); break }
        chain.push(current); seen.add(current)
        if (owners.has(current)) { root = current; break }
        const header = byId.get(current).header
        if (header.origin !== 'subagent') break
        current = header.parentSession
      }
      for (const key of chain) roots.set(key, root)
      return root
    }
    const notices = [], emitted = new Set()
    for (const record of records) {
      const header = record.header
      if (header.origin !== 'subagent' || !header.parentSession || emitted.has(header.id)
        || record.tavernRetirement?.status !== 'parent-unreadable') continue
      const rootSessionId = rootOf(header.parentSession)
      if (!rootSessionId || parentId !== undefined && rootSessionId !== parentId) continue
      emitted.add(header.id)
      notices.push({ sessionId: header.id, parentSessionId: header.parentSession, rootSessionId,
        status: 'parent-unreadable', message: '父会话不可读，退休状态未确认' })
    }
    return { notices }
  }

  async function listTavernSessions() {
    return (await conversationRegistry.list()).map(row=>{const health=runtimeRecovery?.status(row.chatId);return health?{...row,storageHealth:{...health,dataDirectory:dataRoot}}:row})
  }
  function assertConversationIdle(chat) {
    if (chat.regenInProgress || ['pending', 'running'].includes(chat.settleStatus) || backgroundTasks.activity(chat).busy || agentRegistry.get(chat.sessionId)?.phase?.kind === 'running') throw new Error('请等待当前生成或后台处理完成后再修改')
  }
  async function addGuide(sessionId, text) {
    const chat = await chatForSession(sessionId)
    if (chat === undefined) throw new Error('当前会话没有绑定人物卡')
    assertConversationIdle(chat)
    const guide = str(text).trim().slice(0, 2000)
    if (guide === '') throw new Error('Guide 内容不能为空')
    if (!Array.isArray(chat.guides)) chat.guides = []
    if (chat.guides.length >= 20) throw new Error('Guide 数量已达上限（20 条）')
    chat.guides.push({ id: uid('guide'), text: guide, createdAt: Date.now() })
    chat.updatedAt = Date.now()
    await writeChat(chat, { source: 'guide.add' })
    return chat.guides
  }
  // Upstream Guide library (2a5aea0d and follow-ups): plans kept outside any game. A game's guides
  // can be saved as a plan; loading a plan appends it to a game, skipping duplicates, under the
  // same idle rule as adding a guide.
  const guideLibrary = createGuideLibrary({ store: profileData })
  async function playChatForGuides(sessionId) {
    const chat = await chatForSession(sessionId)
    if (chat === undefined || groupOfMode(chat.mode) !== 'play') throw new Error('请先打开游玩会话')
    return chat
  }
  async function saveGuidePlan(sessionId, name) {
    const chat = await playChatForGuides(sessionId)
    return guideLibrary.save(name, Array.isArray(chat.guides) ? chat.guides : [])
  }
  async function loadGuidePlan(sessionId, id) {
    const chat = await playChatForGuides(sessionId)
    assertConversationIdle(chat)
    const plan = await guideLibrary.get(id)
    const saved = await updateChat(chat.id, current => {
      assertConversationIdle(current)
      current.guides = appendGuides(current.guides, plan.guides, { deduplicate: true })
      current.updatedAt = Date.now()
      return current
    }, { source: 'guide.library.load' })
    return saved.guides
  }
  async function deleteGuide(sessionId, id) {
    const chat = await chatForSession(sessionId)
    if (chat === undefined) throw new Error('当前会话没有绑定人物卡')
    assertConversationIdle(chat)
    const saved = await updateChat(chat.id, current => {
      assertConversationIdle(current)
      const index = (current.guides || []).findIndex(guide => typeof id === 'string' && guide.id === id)
      if (index < 0) throw new Error('Guide 不存在或已删除，请刷新')
      current.guides.splice(index, 1);current.updatedAt = Date.now();return current
    }, { source: 'guide.delete' })
    return saved.guides
  }
  async function setPlayerName(sessionId, userName) {
    const chat = await chatForSession(sessionId)
    if (chat === undefined) throw new Error('当前会话没有绑定人物卡')
    assertConversationIdle(chat)
    if ((chat.mode || 'story') === 'card') throw new Error('卡片工作台不使用玩家称呼')
    const name = str(userName).trim().slice(0, 80) || '你'
    if (chat.macroState === null || typeof chat.macroState !== 'object') chat.macroState = { userName: name, local: {}, global: {} }
    else chat.macroState.userName = name
    await writeChat(chat, { source: 'player-name.set' })
    return name
  }
  async function setRequestMode(sessionId, requestMode) {
    const chat = await chatForSession(sessionId)
    if (chat === undefined) throw new Error('当前会话没有绑定人物卡')
    assertConversationIdle(chat)
    if ((chat.mode || 'story') === 'card') throw new Error('卡片工作台不能切换请求模式')
    chat.requestMode = requestMode === 'sillytavern' ? 'sillytavern' : 'dsh'
    await writeChat(chat)
    return chat.requestMode
  }

  // ---------- 后台结算 ----------
  function settleUserText(chat, includePosture = true) {
    const msgs = (chat.messages || []).filter(function (message) {
      return message && (message.role === 'user' || message.role === 'assistant')
    }).slice(-2)
    const lines = [
      ...(includePosture ? ['【上一轮结算姿势】',
      str(chat.posture) !== '' ? projectAgentContent(chat.posture, { charName: chat.cardName, macroState: chat.macroState }).agentText : '（无）'] : []),
      '【最新一轮对话】'
    ]
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i]
      if (m === null || typeof m !== 'object') continue
      const text = projectAgentMessageText(m, { charName: chat.cardName, macroState: chat.macroState })
      if (text.trim() === '') continue
      lines.push((m.role === 'assistant' ? '正文' : '玩家') + ': ' + text)
    }
    return lines.join('\n')
  }
  function applySettlement(chat, result) {
    let postureUpdated = false
    const posture = str(result.posture).trim()
    if (posture !== '') {
      chat.posture = posture
      postureUpdated = true
    }
    return { postureUpdated: postureUpdated }
  }
  function settlementTurn(chat) {
    const messages = Array.isArray(chat && chat.messages) ? chat.messages : []
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index]
      if (message && message.role === 'assistant' && Number.isFinite(Number(message.turn))) return Number(message.turn)
    }
    return 0
  }
  function pendingMvuTarget(chat) {
    const messages = Array.isArray(chat && chat.messages) ? chat.messages : []
    let settledVariables
    for (let messageId = 0; messageId < messages.length; messageId++) {
      const message = messages[messageId]
      if (!message || message.role !== 'assistant') continue
      const swipeId = Math.max(0, Number(message.swipeId) || 0)
      const snapshot = Array.isArray(message.variables) ? message.variables[swipeId] : undefined
      if (!message.mvu || message.mvu.pending !== true) { if (snapshot && !['error', 'stale'].includes(message.mvu?.receipt?.status)) settledVariables=snapshot; continue }
      const variables = settledVariables || snapshot
      return {
        messageId,
        swipeId,
        message,
        variables: variables && typeof variables === 'object' ? structuredClone(variables) : {}
      }
    }
    return null
  }
  async function mvuUpdateRules(chat, card) {
    try {
      const worldBook = await worldBooks.bound(chat.cardPath, card, chat)
      return mvuUpdateRulesFromWorldBook(worldBook).map(function (rule) {
        return projectAgentContent(rule, { charName: card && card.name, macroState: chat.macroState }).agentText
      })
    } catch (_error) {
      return []
    }
  }
  async function prepareNextWorldBookContext(snapshot) {
    const turn = settlementTurn(snapshot)
    const inspected = storyTimeline.inspect({ chat: snapshot })
    if (snapshot.preparedWorldBook && Number(snapshot.preparedWorldBook.revision) === Number(inspected.revision)) return snapshot
    let prepared = null
    let error = null
    try {
      const card = await readChatCard(snapshot)
      const worldBook = await worldBooks.bound(snapshot.cardPath, card, snapshot)
      prepared = prepareWorldBookRecall({ turn, chat: snapshot, card, worldBook, limit: (await readTavernSettings()).worldBookRecallLimit })
    } catch (caught) {
      error = str(caught && caught.message || caught)
      prepared = prepareWorldBookRecall({ turn, chat: snapshot, card: null, worldBook: null })
    }
    const latest = await readChat(snapshot.id)
    if (latest === undefined) return null
    const current = storyTimeline.inspect({ chat: latest })
    if (current.branchId !== inspected.branchId || Number(current.revision) !== Number(inspected.revision)) return latest
    const context = error === null ? str(prepared.context).trim() : ''
    latest.preparedWorldBookContext = context
    latest.preparedWorldBook = {
      ts: Date.now(),
      turn,
      branchId: current.branchId,
      revision: current.revision,
      mode: error === null ? str(prepared.kind) : 'error',
      refs: error === null ? prepared.refs : [],
      totalChars: Number(prepared.totalChars) || 0,
      contextChars: Array.from(context).length,
      empty: error !== null || context === '',
      failed: error !== null
    }
    if (error === null) latest.worldBookReads = prepared.recordReads(latest.worldBookReads)
    latest.worldBookError = error
    latest.lastWorldBookRecall = Object.assign({}, latest.preparedWorldBook)
    await writeChat(latest, { source: 'worldbook.projection' })
    return latest
  }
  async function runSettlement(chatId, signal) {
    while (true) {
      signal?.throwIfAborted()
      let snapshot = await readChat(chatId)
      if (snapshot === undefined) return
      if (Object.values(snapshot.timeline?.operations || {}).some(op => op.kind === 'body' && op.status === 'running')) return
      snapshot = await prepareNextWorldBookContext(snapshot)
      if (snapshot === null) return
      const roundTarget = pendingMvuTarget(snapshot)
      const taskRun = await backgroundTasks.begin(snapshot, 'settlement', {roundTurn: roundTarget?.message.turn ?? settlementTurn(snapshot)})
      snapshot = taskRun.chat
      let backgroundSessionId = str(taskRun.participantRequest.sessionId)
      let backgroundBoundary = null
      try {
        const card = await readChatCard(snapshot)
        const backgroundTasksSettings = playRuntimeSettings(snapshot,await readTavernSettings()).backgroundTasks
        const mvuTarget = snapshot.mvu && snapshot.mvu.enabled === true && snapshot.mvu.owner === 'official'
          ? pendingMvuTarget(snapshot)
          : null
        // R8 1.5: the player switched this game's settlement off; even a deferred floor is skipped.
        const settlementPaused = Boolean(snapshot.mvu?.settlementPaused)
        let text = ''
        let result = null
        let mvuResult = null
        if (mvuTarget !== null && !settlementPaused && (backgroundTasksSettings.variables !== false || mvuTarget.message.mvu.pendingSubmission)) {
          const settlementInput = {
            ledger:snapshot.ledger,
            onPersistentSessionReady: id => taskRun.bindSession(id),
            backgroundTasks: backgroundTasksSettings,
            operationId: taskRun.operationId,
            chatId: snapshot.id,
            branchId: taskRun.basedOn.branchId,
            basedOnRevision: taskRun.basedOn.revision,
            sessionId: snapshot.sessionId,
            turn: mvuTarget.message.turn ?? settlementTurn(snapshot),
            messageId: mvuTarget.messageId,
            swipeId: mvuTarget.swipeId,
            expectedLifecycleRevision: Math.max(0, Number(snapshot.tavernHelperLifecycleRevision) || 0),
            storyText: projectAgentMessageText(mvuTarget.message, { charName: card && card.name, macroState: snapshot.macroState }),
            currentVariables: mvuTarget.variables,
            variableSchema: mvuTarget.variables.schema,
            charName: card && card.name,
            macroState: snapshot.macroState,
            updateRules: await mvuUpdateRules(snapshot, card),
            webSearchEnabled: snapshot.webSearchEnabled === true
          }
          const pendingSubmission = mvuTarget.message.mvu && mvuTarget.message.mvu.pendingSubmission
          if (pendingSubmission && typeof pendingSubmission === 'object') {
            mvuResult = await mvuSettlement.resumeVariables({ ...settlementInput, submission: pendingSubmission })
          } else {
            const selection = await backgroundModelSelection(snapshot)
            if (selection === null) throw new Error('没有可用的模型配置，请先在当前会话的模型选择器中选择模型')
            mvuResult = await mvuSettlement.settleVariables({
              ...settlementInput,
              system: backgroundTasksSettings.posture ? runtimePrompt('posture-settlement') : '',
              selection,
              persistentSessionId: backgroundSessionId,
              signal
            })
          }
          text = str(mvuResult.text) || JSON.stringify({ posture: mvuResult.posture })
          backgroundSessionId = str(mvuResult.traceSessionId) || backgroundSessionId
          backgroundBoundary = Number.isSafeInteger(mvuResult.traceBoundary) ? mvuResult.traceBoundary : null
          if (['error', 'partial'].includes(mvuResult.receipt?.status)) {
            const error = new Error(mvuResult.receipt.summary || mvuResult.receipt.failures?.[0]?.message || '变量结算失败，请重试结算')
            error.mvuReceipt = mvuResult.receipt
            throw error
          }
          result = { posture: mvuResult.posture,ledger:mvuResult.ledger }
        } else if (!backgroundTasksSettings.posture && !backgroundTasksSettings.characterDesign && !backgroundTasksSettings.ledger) {
          result = {}
        } else {
          const selection = await backgroundModelSelection(snapshot)
          if (selection === null) throw new Error('没有可用的模型配置，请先在当前会话的模型选择器中选择模型')
          let submittedPosture = null
          const ledgerSubmission=createLedgerSubmission({enabled:backgroundTasksSettings.ledger,current:snapshot.ledger,turn:settlementTurn(snapshot)})
          let settlementToolTail = Promise.resolve()
          const run = await backgroundAgentRunner.run({
            onPersistentSessionReady: id => taskRun.bindSession(id),
            task: 'settlement',
            persistent: true,
            persistentSessionId: backgroundSessionId,
            rewindTo: taskRun.participantRequest.rewindTo,
            selection,
            messages: [{
              id: 'settle-' + Date.now().toString(36),
              role: 'user',
              regexPlacement: 2,
              content: [{ type: 'text', text: settleUserText(snapshot, backgroundTasksSettings.posture)+(backgroundTasksSettings.ledger?'\n\n'+ledgerContext(snapshot.ledger):'') }],
              source: { kind: 'plugin', plugin: 'dsh-tavern' }
            }],
            system: [
              backgroundTasksSettings.posture ? runtimePrompt('posture-settlement') : '本轮不生成或提交姿势。完成启用的后台任务后简短回复完成。',
              ...(backgroundTasksSettings.characterDesign ? ['若发现重要人物需要建立、补全或修订长期设计，在当前后台 Agent 内调用 skill 加载 tavern-character-design，并按 Skill 读取或保存人物档案；无需也不得创建另一个 Agent。',
              '人物设计保存独立于姿势结算；完成设计后继续当前任务。'] : ['本轮人物设计已关闭，不调用人物设计 Skill 或生成档案。']),
              ...(backgroundTasksSettings.ledger?[LEDGER_RULES]:[]),
              backgroundTasksSettings.posture ? 'posture_submit 是本任务最后一步。' : ''
            ].join('\n\n'),
            tools: [...(backgroundTasksSettings.posture ? [POSTURE_SUBMIT_TOOL] : []), ...(backgroundTasksSettings.characterDesign ? [CHARACTER_DESIGN_READ_TOOL, CHARACTER_DESIGN_SAVE_TOOL] : []),...(backgroundTasksSettings.ledger?[LEDGER_SUBMIT_TOOL]:[])],
            maxToolCalls: 12,
            temperature: 0.2,
            sessionId: snapshot.sessionId,
            webSearchEnabled: snapshot.webSearchEnabled === true,
            signal,
            stopToolsWhen: function () { return (!backgroundTasksSettings.posture || submittedPosture !== null) && ledgerSubmission.complete && (backgroundTasksSettings.posture || backgroundTasksSettings.ledger) },
            acceptWithoutText: function () { return (!backgroundTasksSettings.posture || submittedPosture !== null) && ledgerSubmission.complete && (backgroundTasksSettings.posture || backgroundTasksSettings.ledger) },
            onToolCall(call) {
              const pending = settlementToolTail.then(async function () {
                if(call?.name===LEDGER_SUBMIT_TOOL.name)return ledgerSubmission.execute(call)
                if (call && (call.name === CHARACTER_DESIGN_READ_TOOL.name || call.name === CHARACTER_DESIGN_SAVE_TOOL.name)) {
                  if (!backgroundTasksSettings.characterDesign) return JSON.stringify({ ok: false, error: '人物设计已关闭' })
                  if (submittedPosture !== null) return JSON.stringify({ ok: false, retryable: false, error: '姿势已经提交，本轮后台任务已结束' })
                  return await characterDesignDocuments.execute(snapshot.id, call)
                }
                if (!backgroundTasksSettings.posture || !call || call.name !== POSTURE_SUBMIT_TOOL_NAME) {
                  return JSON.stringify({ ok: false, retryable: true, error: '当前结算任务不接受该工具；请按当前工具目录补查设定或调用已启用的结算工具' })
                }
                try {
                  submittedPosture = normalizePostureSubmission(call.arguments, {
                    charName: card && card.name,
                    macroState: snapshot.macroState
                  })
                  return JSON.stringify({ ok: true })
                } catch (error) {
                  return JSON.stringify({ ok: false, retryable: true, error: str(error && error.message || error) })
                }
              })
              settlementToolTail = pending.catch(function () {})
              return pending
            }
          })
          await settlementToolTail
          if (backgroundTasksSettings.posture && submittedPosture === null) throw new Error('后台 Agent 未调用 posture_submit 提交有效姿势')
          if(!ledgerSubmission.complete)throw new Error('后台 Agent 未调用 ledger_submit 提交台账变化')
          result = { ...(submittedPosture || {}),...(ledgerSubmission.result?{ledger:ledgerSubmission.result}:{}) }
          text = str(run.text) || JSON.stringify(result)
          backgroundSessionId = str(run.traceSessionId)
          backgroundBoundary = Number.isSafeInteger(run.traceBoundary) ? run.traceBoundary : null
        }
        signal?.throwIfAborted()
        let stat = { postureUpdated: false }
        const waitingRuntime = Boolean(mvuResult && mvuResult.receipt && mvuResult.receipt.status === 'pending')
        const completion = {
          stateChanged: Boolean(mvuResult && mvuResult.receipt && mvuResult.receipt.status === 'updated') ||
            str(result && result.posture).trim() !== '' || !!result?.ledger,
          participant: backgroundBoundary === null ? null : taskRun.participant({ sessionId: backgroundSessionId, boundary: backgroundBoundary }),
          apply(draft) {
            if (mvuResult && mvuResult.effect) applyMvuSettlementEffect(draft, mvuResult.effect)
            stat = applySettlement(draft, result)
            if(result?.ledger)draft.ledger=structuredClone(result.ledger)
            if (mvuTarget && mvuResult === null && (backgroundTasksSettings.variables === false || settlementPaused)) {
              const target = draft.messages[mvuTarget.messageId]
              if (target && Math.max(0, Number(target.swipeId) || 0) === mvuTarget.swipeId) {
                const { pendingSubmission: _skippedSubmission, ...mvu } = target.mvu || {}
                target.mvu = { ...mvu, pending: false, receipt: { version: 1, status: 'skipped', summary: settlementPaused ? '本局已关闭 MVU 变量结算，这一层没有更新变量。' : '变量结算已关闭，本轮未更新变量。', changes: [], sideEffects: [], failures: [] } }
              }
            }
            if (mvuResult !== null) {
              const target = draft.messages[mvuTarget.messageId]
              if (target && target.role === 'assistant' && Math.max(0, Number(target.swipeId) || 0) === mvuTarget.swipeId) {
                const receipt = structuredClone(mvuResult.receipt)
                const waitingRuntime = receipt.status === 'pending'
                target.mvu = {
                  pending: waitingRuntime,
                  modified: receipt.status === 'updated',
                  diagnostics: receipt.status === 'stale' ? [{ message: receipt.summary }] : [],
                  events: receipt.status === 'stale' ? [] : ['MESSAGE_RECEIVED'],
                  receipt,
                  ...(waitingRuntime ? { pendingSubmission: structuredClone(mvuResult.submission) } : {})
                }
                if (!waitingRuntime && !['error', 'partial', 'stale'].includes(receipt.status)) {
                  const variables = target.variables?.[mvuTarget.swipeId]
                  if (variables !== undefined) for (let index=mvuTarget.messageId+1;index<draft.messages.length;index++) {
                    const following=draft.messages[index]
                    if (following.role==='assistant' && !following.mvu?.pending) break
                    if (!['user','assistant'].includes(following.role)) continue
                    following.variables ||= []
                    following.variables[Math.max(0,Number(following.swipeId)||0)]=structuredClone(variables)
                  }
                }
              }
            }
            draft.settleStatus = waitingRuntime ? 'waiting-runtime' : 'done'
            draft.settleError = null
            draft.lastSettle = { ts: Date.now(), posture: stat.postureUpdated, raw: text.slice(0, 200) }
          }
        }
        const completed = waitingRuntime ? await taskRun.defer(completion) : await taskRun.commit(completion)
        if (completed.status === 'missing') return
        if (completed.status === 'stale') {
          const activity = backgroundTasks.activity(completed.chat)
          if (activity.role === 'settlement' && (activity.phase === 'pending' || activity.phase === 'running')) continue
          return
        }
        if (completed.status === 'deferred') {
          // Initialization may settle while the pending submission is being saved.
          // Recheck here so a ready/failure notification cannot be lost in that gap.
          const runtimeState = tavernScriptDispatch.status(snapshot.sessionId)
          if (runtimeState.ready && !runtimeState.busy && !runtimeState.mvuValidationBlocked || runtimeState.initializationError) continue
          console.log('dsh-tavern: 变量结算等待 MVU 运行时接续', chatId)
          return
        }
        console.log('dsh-tavern: 结算完成', chatId, '姿势', stat.postureUpdated ? '已更新' : '未更新')
        console.log('dsh-tavern: 结算原始输出:', text.slice(0, 200))
        if (mvuTarget && pendingMvuTarget(completed.chat)) continue
        return
      } catch (err) {
        if (signal?.aborted) return
        if (backgroundSessionId === '') backgroundSessionId = str(err && err.traceSessionId)
        if (backgroundBoundary === null && Number.isSafeInteger(err && err.traceBoundary)) backgroundBoundary = err.traceBoundary
        const failed = await taskRun.commit({
          status: 'failed',
          stateChanged: false,
          participant: backgroundBoundary === null ? null : taskRun.participant({ sessionId: backgroundSessionId, boundary: backgroundBoundary })
        })
        if (failed.status === 'missing') return
        if (failed.status === 'stale') {
          const activity = backgroundTasks.activity(failed.chat)
          if (activity.role === 'settlement' && (activity.phase === 'pending' || activity.phase === 'running')) continue
          return
        }
        const latest = await readChat(chatId)
        if (latest === undefined) return
        const target = pendingMvuTarget(latest)
        const message = str(err && err.message || err) || '后台结算失败'
        if (target !== null) {
          target.message.mvu = {
            pending: false,
            modified: false,
            diagnostics: [{ message }],
            events: [],
            receipt: err?.mvuReceipt ? structuredClone(err.mvuReceipt) : { version: 1, status: 'error', summary: '', changes: [], failures: [{ command: '', message }] }
          }
        }
        latest.settleStatus = 'failed'
        latest.settleError = message
        await writeChat(latest, { source: target === null ? 'settlement.posture-failed' : 'settlement.mvu-failed' })
        console.error('dsh-tavern: 结算失败', chatId, str(err && err.message || err))
        return
      }
    }
  }
  function queueSettlement(chatId) {
    const existing = settlementJobs.get(chatId)
    if (existing !== undefined) return existing.promise
    const job = { controller: new AbortController(), promise: null }
    job.promise = runSettlement(chatId, job.controller.signal).finally(function () {
      if (settlementJobs.get(chatId) === job) settlementJobs.delete(chatId)
    })
    settlementJobs.set(chatId, job)
    return job.promise
  }
  async function cancelSettlement(chatId, options = {}) {
    const job = settlementJobs.get(chatId)
    if (job === undefined) return false
    job.controller.abort()
    if (options.wait === false) {
      if (settlementJobs.get(chatId) === job) settlementJobs.delete(chatId)
    } else await job.promise.catch(function () {})
    return true
  }
  const mvuSettlementReconciler = createMvuSettlementReconciler({
    list: () => conversationRegistry.list(),
    resolve: sessionId => chatForSession(sessionId),
    shouldResume: function (chat) {
      const target = pendingMvuTarget(chat)
      return Boolean(target && target.message.mvu && target.message.mvu.pendingSubmission
        && backgroundTasks.activity(chat).phase === 'pending'
        && agentRegistry.get(chat.sessionId)?.phase?.kind !== 'running'
        && !Object.values(chat.timeline?.operations || {}).some(op => op.kind === 'body' && op.status === 'running'))
    },
    isReady: function (sessionId) {
      const state = tavernScriptDispatch.status(sessionId)
      return state.ready && !state.busy && !state.mvuValidationBlocked || Boolean(state.initializationError)
    },
    resume: chatId => queueSettlement(chatId),
    onError: async function (error, sessionId, status) {
      console.error(status.blocked ? 'dsh-tavern: MVU 接续连续失败，已停止自动重试' : 'dsh-tavern: MVU 接续失败，将退避重试', str(error && error.message || error))
      await mvuDiagnostics.record(sessionId,{stage:'settlement-recovery',...status,error:str(error && error.message || error)})
    }
  })
  const unsubscribeMvuRuntimeReady = tavernScriptDispatch.subscribeSettled(function (sessionId) {
    void mvuSettlementReconciler.wake(sessionId)
  })
  void mvuSettlementReconciler.scan()
  ctx.effect(() => function () {
    unsubscribeMvuRuntimeReady()
    mvuSettlementReconciler.dispose()
  }, 'dsh-tavern: reconcile deferred MVU settlement')
  async function stopBackground(sessionId, operationId) {
    const chat = await chatForSession(sessionId)
    if (!chat) throw new Error('对话不存在')
    const activity = backgroundTasks.activity(chat)
    if (!operationId || activity.operationId !== operationId || !activity.busy) return { stopped: false, view: await view(chat, await readChatCard(chat)) }
    // Abort the provider request first; interrupted operations reject late commits.
    backgroundAgentRunner.cancel(chat.sessionId)
    await cancelSettlement(chat.id, { wait: false })
    const stopped = await backgroundTasks.recover(chat, { operationId })
    return { stopped: stopped.status !== 'stale', view: await view(stopped.chat, await readChatCard(stopped.chat)) }
  }

  // R8 1.5: an MVU core that can never work in this game (incompatible, terminal error) is
  // explained when the player sends, not after a long wait; the turn stops before any request.
  function assertMvuCoreUsable(chat) {
    if (chat?.mvu?.enabled !== true || chat.mvu.settlementPaused) return
    const error = str(tavernScriptDispatch.status(chat.sessionId).initializationError).trim()
    if (!error) return
    const reason = error.replace(/^MVU 模块加载失败：/, '').replace(/\s*请刷新页面或重启酒馆后重试。?$/, '').slice(0, 300)
    throw Object.assign(new Error('这张卡的 MVU 变量系统没法在这里运行：' + reason + '\n本轮没有发送。可以在页面上方的 MVU 提示里选「关闭本局 MVU 变量结算并继续」（剧情照常，变量不再更新），或在「脚本管理」里换用兼容的 MVU 版本后再发送。'), { code: 'DSH_TAVERN_MVU_CORE_UNUSABLE' })
  }
  // R8 1.5: a core that cannot work in this game (incompatible, terminal error) need not
  // stop the story. The player can switch this game's MVU settlement off: replies continue,
  // pending floors are recorded as skipped, and it can be switched back on later.
  async function setMvuSettlementPaused(sessionId, paused) {
    const chat = await chatForSession(sessionId)
    if (chat === undefined) throw new Error('当前会话没有绑定人物卡')
    if (chat.mvu?.enabled !== true) throw new Error('本局没有启用 MVU 变量')
    const reason = paused ? str(tavernScriptDispatch.status(sessionId).initializationError).slice(0, 600) : ''
    await updateChat(chat.id, current => {
      if (current?.mvu?.enabled !== true) return current
      const mvu = { ...current.mvu }
      if (paused) mvu.settlementPaused = { version: 1, at: Date.now(), ...(reason ? { reason } : {}) }
      else delete mvu.settlementPaused
      current.mvu = mvu
      return current
    }, { source: 'mvu.settlement-paused' })
    if (paused) void queueSettlement(chat.id).catch(error => console.error('dsh-tavern: 关闭 MVU 结算后整理待结算楼层失败', str(error && error.message || error)))
    const latest = await chatForSession(sessionId)
    return await view(latest, await readChatCard(latest))
  }
  async function retrySettlement(sessionId, turn, guidance) {
    const chat = await chatForSession(sessionId)
    if (chat === undefined) throw new Error('当前会话没有绑定人物卡')
    if (chat.regenInProgress || agentRegistry.get(sessionId)?.phase?.kind === 'running' || Object.values(chat.timeline?.operations || {}).some(op => op.kind === 'body' && op.status === 'running')) throw new Error('请等待当前正文生成完成后再重试结算')
    const activity = backgroundTasks.activity(chat)
    if (activity.busy) throw new Error('后台 Agent 正在运行，请稍候')
    const messages = Array.isArray(chat.messages) ? chat.messages : []
    let target = null
    for (let messageId = messages.length - 1; messageId >= 0; messageId--) {
      const message = messages[messageId]
      if (!message || message.role !== 'assistant' || message.greeting === true) continue
      target = { messageId, message }
      break
    }
    if (target === null || Math.max(0, Number(target.message.turn) || 0) !== Math.max(0, Number(turn) || 0)) {
      throw new Error('只能重试当前最新正文的后台结算')
    }
    const officialMvu = chat.mvu && chat.mvu.enabled === true && chat.mvu.owner === 'official'
    if (officialMvu) {
      if (!target.message.mvu) throw new Error('当前最新正文没有可重试的变量结算')
      if (['updated', 'unchanged', 'skipped'].includes(target.message.mvu.receipt?.status)) throw new Error('当前正文已经结算，不能重复应用变量变更')
      const nextGuidance=guidance===undefined?str(target.message.mvu.guidance).trim():str(guidance).trim()
      target.message.mvu = { pending: true, modified: false, diagnostics: [], events: [], ...(nextGuidance?{guidance:nextGuidance}:{}) }
    } else if (activity.phase !== 'failed' || activity.role !== 'settlement') {
      throw new Error('当前最新正文没有失败的后台结算')
    }
    chat.settleStatus = 'pending'
    chat.settleError = null
    chat.updatedAt = Date.now()
    await writeChat(chat, { source: 'settlement.retry' })
    mvuSettlementReconciler.reset(sessionId)
    void queueSettlement(chat.id).catch(function (error) {
      console.error('dsh-tavern: 重试后台结算失败', str(error && error.message || error))
    })
    return await view(chat, await readChatCard(chat))
  }
  async function pullBackgroundCycle(sessionId) {
    let chat = await chatForSession(sessionId)
    if (chat === undefined) throw new Error('当前会话没有绑定人物卡')
    let shouldRun = false
    if (isOpeningAwaitingSettlement(chat)) {
      chat.settleStatus = 'running'
      chat.settleError = null
      await writeChat(chat, { source: 'settlement.opening-prepare' })
      shouldRun = true
    }
    const activity = backgroundTasks.activity(chat)
    if (activity.role === 'settlement' && (activity.phase === 'pending' || activity.phase === 'running')) shouldRun = true
    if (!shouldRun) return true
    void queueSettlement(chat.id)
    return false
  }
  // ---------- 卡片工作台：挂载剧本与新卡创建 ----------
  async function sourceWindowOf(chat) {
    const out = []
    for (const sourcePath of (chat.workspace && chat.workspace.sourcePaths) || []) {
      const src = await readSource(sourcePath)
      if (src === undefined || !Array.isArray(src.chunks)) continue
      const title = str(src.title) || '剧本'
      for (const chunk of src.chunks) {
        out.push({ chunkId: sourcePath + '/' + chunk.id, title: title, order: chunk.order, text: chunk.text })
      }
    }
    return out
  }
  async function prepareWorkspace(chat, nativeTurn) {
    const state = chat.workspace
    if (state === null || typeof state !== 'object') throw new Error('卡片工作台状态不存在')
    if (state.prepared !== null && typeof state.prepared === 'object' && Number(state.prepared.nativeTurn) === Number(nativeTurn)) return state.prepared
    const all = await sourceWindowOf(chat)
    const cursor = Math.max(0, Number(state.cursor) || 0)
    const window = all.slice(cursor, cursor + 6)
    state.prepared = { nativeTurn: Number(nativeTurn) || 0, window: window, cursorBefore: cursor, total: all.length }
    return state.prepared
  }
  function commitWorkspace(chat, nativeTurn) {
    const state = chat.workspace
    if (state === null || typeof state !== 'object') return
    const prepared = state.prepared
    if (prepared !== null && typeof prepared === 'object' && Number(prepared.nativeTurn) === Number(nativeTurn)) {
      state.cursor = Math.min(prepared.total, (Number(prepared.cursorBefore) || 0) + prepared.window.length)
      state.prepared = null
    }
  }
  function workspaceViewOf(chat) {
    const state = chat.workspace || {}
    return {
      mountedResources: Array.isArray(state.mountedResources) ? state.mountedResources : []
    }
  }
  async function createWorkspaceCard(chat, state) {
    const draft = state.draft !== null && typeof state.draft === 'object' ? state.draft : {}
    if (str(draft.name).trim() === '') throw new Error('新人物卡还没有角色名，请先在对话中确认')
    const player = str(state.player)
    if (player === '') throw new Error('玩家（{{user}}）身份还没有确认。请先在对话中告诉助手“玩家是XX”。')
    const workspace = cardPreparation.create({ kind: 'draft', draft: draft, player: player, sourcePaths: state.sourcePaths || state.sourceIds || [] })
    const card = cardPreparation.project(workspace)
    const cardPath = await fileResources.importCard({ name: card.name + '.json', text: JSON.stringify(workspace.raw, null, 2) }, workspace)
    card.path = cardPath
    const idx = await readIndex()
    for (const row of idx.chats || []) {
      if (row.id === chat.id) { row.cardPath = cardPath; row.cardName = card.name }
    }
    await writeIndex(idx)
    return { path: cardPath, card }
  }
  const foregroundFrameBuilder = createForegroundFrameBuilder()
  const foregroundFrameSessionAdapter = createForegroundFrameSessionAdapter({ id: randomUUID })
  async function awaitForegroundPostCommit(sessionId) {
    const control = spPostCommitControls.get(sessionId)
    if (control) {
      control.skipOptional = true
      if (control.phase === 'optional') control.controller.abort(new Error('开始下一轮，已停止上一轮的自动摘要与状态栏补充'))
    }
    await spPostCommitJobs.get(sessionId)?.catch(() => {})
  }
  function afterForegroundCommit(chat) {
    if (chat.regenInProgress === true) return
    const control = { phase: 'required', skipOptional: false, controller: new AbortController() }
    spPostCommitControls.set(chat.sessionId, control)
    const work = (async () => {
      await fullTemplateCommitter.flush(chat.sessionId)
      await helperEvents.flush(chat.sessionId)
      let currentChat = await chatForSession(chat.sessionId)
      if (['pending', 'running'].includes(currentChat?.settleStatus)) await queueSettlement(chat.id)
      currentChat = await chatForSession(chat.sessionId)
      if (currentChat?.settleStatus === 'failed') return
      if (!extensionRuntime.installed() || extensionRuntime.usesOriginal(chat.sessionId)) return
      const filled = await spDatabase.afterCommit(await chatForSession(chat.sessionId))
      if (filled?.activity && ['failed', 'cancelled'].includes(filled.activity.status)) return
      await spDatabase.beforeTurn(chat.sessionId)
      const current = await chatForSession(chat.sessionId)
      if (current.timeline?.branchId !== chat.timeline?.branchId || current.timeline?.revision !== chat.timeline?.revision) return
      if (control.skipOptional || control.controller.signal.aborted) return
      control.phase = 'optional'
      const signal = control.controller.signal
      if (databaseState(current).settings.summary.enabled) { const summarized = await spAdvanced.task(chat.sessionId, 'summary', {signal}); if (summarized.maintenance?.status !== 'completed') return }
      if (signal.aborted) return
      await spCompanion.afterCommit(current, {signal})
    })()
    spPostCommitJobs.set(chat.sessionId, work)
    void work.catch(() => {}).finally(() => { if (spPostCommitJobs.get(chat.sessionId) === work) spPostCommitJobs.delete(chat.sessionId); if (spPostCommitControls.get(chat.sessionId) === control) spPostCommitControls.delete(chat.sessionId) })
    return work
  }

  const turnOrchestrator = createTurnOrchestrator({
    promptLimits:capacityLimits.prompts,
    captureSceneWorldbook,
    store: {
      chatForSession,
      readCard,
      readCardExtensions,
      readScript,
      writeChat,
      updateChat,
      updateCard,
      createCard: createWorkspaceCard
    },
    planner: contextPlanner,
    scripts: scriptContinuity,
    timeline: storyTimeline,
    frameBuilder: foregroundFrameBuilder,
    cards: cardPreparation,
    workspace: {
      prepare: prepareWorkspace,
      commit: commitWorkspace
    },
    renderMacros: function (text, chat, options) {
      return renderCardText(text, { name: chat.cardName }, chat.macroState, options)
    },
    projectReply: projectRuntimeReply,
    projectWorldBookTemplates: input => nativeWorldBookTemplateContext(input.chat, input.card, {foreground:true,turn:input.turn}),
    projectScriptPromptWorldbook: async function ({ chat, card, turn }) {
      const text = scriptPromptScanText(chat,capacityLimits.prompts)
      if (!text.trim()) return null
      const worldBook = await worldBooks.bound(chat.cardPath, card, chat)
      return prepareWorldBookRecall({ chat, card, turn, worldBook, latestBody: text, limit: (await readTavernSettings()).worldBookRecallLimit })
    },
    resolvePresetRegexScripts: async function (chat) {
      if (!chat || groupOfMode(chat.mode) !== 'play') return []
      const snapshot = effectiveGamePreset(chat)
      return Array.isArray(snapshot && snapshot.regexScripts) ? snapshot.regexScripts : []
    },
    prepareCommit: async input => {const before=await chatForSession(input.chat.sessionId);input={...input,chat:consumeTemplateInput(input.chat)};const prepared=await fullTemplateEnabled(input.chat,{texts:[input.reply?.sourceText]})?await fullTemplateCommitter.prepare(input):input;if(!prepared.chat.regenInProgress)prepared.chat=helperEvents.stageGeneration(helperEvents.stageHistory(before,prepared.chat),input.generationId);return prepared},
    prepareUserInput: async (chat,operationId) => {
      if(!hasTavernScriptRuntime(chat,await effectiveHelperScripts(chat)))return chat
      await writeChat(helperEvents.stageInput(chat,operationId),{source:'helper.input-admission'})
      await helperEvents.flush(chat.sessionId)
      return chatForSession(chat.sessionId)
    },
    beforePrepare: async sessionId => { await runtimeRecovery?.waitSession(sessionId); await fullTemplateCommitter.flush(sessionId); const chat = await chatForSession(sessionId); if (chat && groupOfMode(chat.mode) === 'play') { assertMvuCoreUsable(chat); await awaitForegroundPostCommit(sessionId); await helperEvents.flush(sessionId); await spDatabase.beforeTurn(sessionId); await gameResourceBindings.refresh(sessionId,{requestBoundary:true}) } },
    afterCommit: afterForegroundCommit,
    databaseEnabled:chat=>extensionRuntime.installed()&&!extensionRuntime.usesOriginal(chat?.sessionId),
    prepareDatabaseMemory: input => extensionRuntime.installed()&&!extensionRuntime.usesOriginal(input.chat?.sessionId)?spAdvanced.prepare(input):{worldBookContext:input.worldBookContext},
    rewriteBody: input => extensionRuntime.installed()&&!extensionRuntime.usesOriginal(input.chat?.sessionId)?spAdvanced.rewrite(input):input.text,
    prepareDatabasePlot: input => spDatabase.preparePlot(input),
    onPreparationWarning: error => console.error('dsh-tavern: 辅助召回/推进失败，本轮沿用原世界书继续', str(error?.message || error)),
    now: Date.now,
    shellToolName: process.platform === 'win32' ? 'pwsh' : 'bash'
  })
  async function clearFailedInputsBeforeTurn(sessionId){
    const chat=await chatForSession(sessionId)
    if(!chat||!['story','script'].includes(chat.mode||'story'))return []
    const session=sessionStore.get(sessionId)||agentRegistry.get(sessionId)?.session
    if(!session)return []
    const events=sessionEvents(session),ids=new Set(),before=new Set(session.surface?.nodes||[])
    const turns=[...new Set(events.filter(event=>event?.type==='turn/end'&&['error','aborted','interrupted'].includes(event.data?.reason?.kind)&&!chat.nativeCommits?.[String(event.data.turn)]).map(event=>Number(event.data.turn)))]
    let changed=0
    for(const turn of turns){await turnOrchestrator.discard({sessionId,turn});changed+=clearFailedTurnSurface({session,turn})}
    if(changed){
      const visible=new Set(session.surface?.nodes||[])
      for(const event of events)if(before.has(event.seq)&&!visible.has(event.seq)){const id=event.data?.id||event.data?.message?.id;if(id)ids.add(id)}
      await sessionStore.flush(session)
    }
    return [...ids]
  }
  const foregroundHandoff = createForegroundHandoff({
    turns: turnOrchestrator,
    prepareOpeningWorldBook: prepareNextWorldBookContext,
    store: { chatForSession, readChat },
    tasks: backgroundTasks,
    queueBackground: queueSettlement,
    clearFailedTurns:clearFailedInputsBeforeTurn,
    onError: (input, stage, error) => runtimeNotices.report(input, stage, error),
    onSuccess: (input, stage) => runtimeNotices.clear(input, stage),
    onInterrupted: async (input, before) => {
      if(!before || !hasTavernScriptRuntime(before,await effectiveHelperScripts(before)))return
      const operation=Object.values(before.timeline?.operations||{}).findLast(op=>op.kind==='body'&&Number(op.turn)===Number(input.turn))
      await updateChat(before.id,chat=>helperEvents.stageStopped(chat,operation?.id||'native-turn:'+input.turn),{source:'helper.generation-stopped'})
      helperEvents.schedule(input.sessionId)
    },
    cleanupFailedTurn: async function (input) {
      const mode = await turnOrchestrator.modeFor(input.sessionId)
      if (mode !== 'story' && mode !== 'script') return 0
      const liveAgent = agentRegistry.get(input.sessionId)
      const liveSession = sessionStore.get(input.sessionId) || (liveAgent && liveAgent.session)
      return clearFailedTurnSurface({ session: liveSession, turn: input.turn })
    },
    logger: console
  })

  let settleRuntimeReadiness
  const runtimeReadiness = new Promise(function (resolve) { settleRuntimeReadiness = resolve })
  async function initializeRuntimeState() {
    await migrationSettings.migrate()
    await scriptVariablePolicy.recover()
    await fileResources.migrateLegacy(await readIndex(), readJson, writeIndex, readChat, writeChat)
    await presetLibrary.migrate()
    await resourceGraph.recover()
    await resourceIdentities.initializeVariableScopes([...(await fileResources.list('card')),...(await fileResources.list('preset'))])
    await helperWorldbooks.recover()
    return await readIndex()
  }
  async function recoverRuntimeHistory() {
    const report = await runtimeRecovery.run({ repair: true, prepare: true })
    for (const row of report.results) if (['blocked','unknown','partial'].includes(row.status)) console.warn('dsh-tavern: 状态恢复需检查', row.chatId, row.status, row.error || row.remaining)
  }
  // ---------- 重新生成正文（生成即替换，无确认） ----------
  const { regenerate: regenBody, rollback: rollbackTurn, rollbackPreview, recover: recoverRoundHistory } = createRoundHistory({
    diagnostics: mvuDiagnostics,
    checkOriginalSpInstalled: sessionId => extensionRuntime.usesOriginal(sessionId),
    prepareOriginalSpRollback: async (chat, { materialize }) => {
      // Keep the original plugin's floor payloads, including delta logs and
      // unknown fields, in the existing verified recovery pool before asking
      // that plugin to materialize its current state for a shortened history.
      const backupPath = 'recovery/sp-original-rollback/' + uid('sp') + '.json'
      await profileData.writeJson(backupPath, { version: 1, chat: structuredClone(chat) })
      await verifiedBackups.remember('sp-original-rollback:' + chat.id, backupPath)
      if (!materialize) return chat
      const result = await tavernScriptHostAdapter.dispatchEvent({
        sessionId: chat.sessionId,
        name: 'DSH_SP_ROLLBACK_CHECKPOINT',
        args: [{ receipt: null }],
        work: { onlyScriptIds: ['extension-sp-database'] }
      })
      if (result.handled !== true || result.args?.[0]?.receipt?.success !== true) {
        throw new Error(result.error || 'SP 原包尚未完成回退准备；当前剧情与原始恢复副本已保留')
      }
      assertOriginalSpRollbackReceipt(result.args[0].receipt)
      return await readChat(chat.id)
    },
    prepareOriginalSpRollbackDeletion: async (chat, { keep }) => {
      // The original's live instance deletes the latest floors under its own
      // rules and returns what changed on the survivors (1.7); the rollback
      // commit stores that. Keep the untouched floors as a verified copy first.
      const backupPath = 'recovery/sp-original-rollback/' + uid('sp') + '.json'
      await profileData.writeJson(backupPath, { version: 1, chat: structuredClone(chat) })
      await verifiedBackups.remember('sp-original-rollback:' + chat.id, backupPath)
      const result = await tavernScriptHostAdapter.dispatchEvent({
        sessionId: chat.sessionId,
        name: 'DSH_SP_ROLLBACK_DELETE',
        args: [{ keep, receipt: null }],
        work: { onlyScriptIds: ['extension-sp-database'] }
      })
      if (result.handled !== true || result.args?.[0]?.receipt?.success !== true) {
        throw new Error(result.error || 'SP 原包尚未完成回退删楼；当前剧情与原始恢复副本已保留')
      }
      return assertOriginalSpDeletionReceipt(result.args[0].receipt, keep)
    },
    chats: { read: readChat, forSession: chatForSession, forSessionReadonly: chatForSessionReadonly, readCard: readChatCard,
      readRevision: readChatRevision, write: writeChat, update: updateChat },
    sessions: { get: function (sessionId) { return ctx.get('agents')?.get(sessionId) },
      getSession: sessionId => sessionStore.get(sessionId),
      ensureForeground: resolveForegroundAgent,
      resume: sessionId => agentRegistry.resume({ resumeSessionId: sessionId }),
      flush: session => sessionStore.flush(session) },
    scripts: { read: readScript, continuity: scriptContinuity,
      stageRegeneration:(chat,id)=>helperEvents.stageRegeneration(chat,id),
      dispatchEvent: function (event) { return tavernScriptHostAdapter.dispatchEvent(event) } },
    timeline: storyTimeline,
    queueSettlement,
    afterCommit: afterForegroundCommit,
    cancelSettlement,
    present: view
  })

  runtimeRecovery = createRuntimeRecovery({
    dataDirectory:dataRoot,
    prepare:async(chat,{signal})=>{
      try {const migrated=await presetLibrary.migrateChat(chat);signal.throwIfAborted();if(migrated)await writeChat(chat,{source:'runtime.recovery.preset-migration',signal})}
      catch(error){signal.throwIfAborted();console.warn('dsh-tavern: 旧对话预设条目配置迁移失败',chat.id,error)}
      signal.throwIfAborted()
      if(chat.presetHistory?.some(p=>p.snapshot!==undefined)||(chat.tavernScriptTrees&&chat.runtimePresetSnapshot?.scriptLibrary))await playManagement.compact(chat.id,{signal})
      signal.throwIfAborted();await syncChatSummary(chat)
    },
    onBackupCompleted:verifiedBackups.remember,
    list: async () => (await readIndex()).chats || [], read: readChat, readRevision: readChatRevision,
    update: updateChat, store: profileData, timeline: storyTimeline, scripts: scriptContinuity, readScript,
    recoverHistory: recoverRoundHistory,
    sidecars: (chat, options) => sceneIllustrations?.recoverChat(chat, options) || [],
    isActive: chat => agentRegistry.get(chat.sessionId)?.phase?.kind === 'running' || settlementJobs.has(chat.id)
      || spPostCommitJobs.has(chat.sessionId) || extensionRuntime.installed() && spDatabase.isActive?.(chat.id) === true || autoCompaction?.isActive(chat.id) === true
      || candidateTasks.isActive(chat) || Object.values(chat.timeline?.participants || {}).some(p => agentRegistry.get(p.sessionId)?.phase?.kind === 'running'),
    facts: async (chat,{signal}) => {
      const live = sessionStore.get(chat.sessionId) || agentRegistry.get(chat.sessionId)?.session
      if (live) return { known: true, exists: true, source: 'live-session', events: sessionEvents(live), nodes: live.surface?.nodes || [] }
      const persistence = ctx.get('sessionPersistence')
      if (!persistence) return { known: false, source: 'persistence-unavailable' }
      let handle
      try {
        handle = await persistence.open(chat.sessionId, 'read')
        signal.throwIfAborted()
        const snapshot = await handle.read(0)
        signal.throwIfAborted()
        const detached = sessionStore.prepare(chat.sessionId, { seed: snapshot.events, meta: structuredClone(handle.header), eventState: snapshot.eventState })
        return { known: true, exists: true, source: 'persisted-session', events: snapshot.events, nodes: detached.surface?.nodes || [] }
      } catch (error) {
        signal.throwIfAborted()
        if (error.name === 'SessionPersistenceNotFoundError') return { known: true, exists: false, source: 'session-not-found', events: [] }
        return { known: false, source: 'session-read-failed' }
      } finally { await handle?.close() }
    }
  })

  const storyAlignment = createStoryAlignment({
    list: async () => (await readIndex()).chats || [], read: readChatReadonly, readRevision: readChatRevision,
    update: updateChat, store: profileData, agent: id => agentRegistry.get(id),
    busy: chat => Boolean(settlementJobs.has(chat.id) || spPostCommitJobs.has(chat.sessionId) || spDatabase.isActive?.(chat.id)
      || autoCompaction?.isActive(chat.id) || candidateTasks.isActive(chat) || sceneIllustrations?.isActive(chat.id)
      || helperGenerations.busy(undefined,chat.sessionId) || historyOperations.isRunning(chat.sessionId)
      || ['pending','running'].includes(chat.settleStatus) || backgroundTasks.activity(chat).busy
      || Object.values(chat.timeline?.participants || {}).some(p => agentRegistry.get(p.sessionId)?.phase?.kind === 'running')),
    native: async chat => {
      const live=sessionStore.get(chat.sessionId) || agentRegistry.get(chat.sessionId)?.session
      if(live)return live
      const persistence=ctx.get('sessionPersistence');if(!persistence)return null
      let handle
      try {handle=await persistence.open(chat.sessionId,'read');const snapshot=await handle.read(0);const detached=sessionStore.prepare(chat.sessionId,{seed:snapshot.events,meta:structuredClone(handle.header),eventState:snapshot.eventState});return {id:chat.sessionId,header:structuredClone(handle.header),surface:{nodes:[...detached.surface.nodes]},snapshotEvents:()=>snapshot.events}}
      catch(error){if(error.name==='SessionPersistenceNotFoundError')return null;throw error}
      finally {await handle?.close()}
    },
    flush: session => sessionStore.flush(session), onBackupCompleted: verifiedBackups.remember,
    exclusive: async (chatId,work) => {
      const target=await profileSessionAccess.exportTarget(chatId)
      await runtimeRecovery.waitSession(target.sessionId)
      await resolveForegroundAgent(target.sessionId)
      const agent=agentRegistry.get(target.sessionId)
      if(typeof agent?.runMaintenance!=='function')throw Error('当前原生内核不提供空闲独占维护，请升级后修复')
      return agent.runMaintenance(signal => maintenanceGate.write(() => work({agent,signal})))
    }
  })

  const inputEditor=createInputEditor({chats:{forSession:chatForSession},history:historyOperations,present:view})
  const bodyEditor = createBodyEditor({
    history: historyOperations,
    chats: { forSession: chatForSession, update: updateChat },
    sessions: { get: id => ctx.get('agents')?.get(id), flush: session => sessionStore.flush(session) },
    timeline: storyTimeline,
    activity: chat => backgroundTasks.activity(chat),
    project: async (text, chat) => {
      const extensions = await readCardExtensions(chat.cardPath)
      return projectRuntimeReply(text, { charName: chat.cardName, macroState: chat.macroState,
        regexScripts: composeTavernRegexScripts(extensions, effectiveGamePreset(chat)?.regexScripts), placement: 2, isEdit: false, depth: 0 })
    },
    present: async chat => view(chat, await readChatCard(chat))
  })

  // ---------- HTTP RPC（客户端同源 fetch） ----------
  async function retentionBusy(chat){
    const rows=chat?[]:(await readIndex()).chats||[],live=new Set(rows.map(row=>typeof row==='string'?row:row.id))
    if(!chat)for(const id of maintenanceChatIdentity.keys())if(!live.has(id))forgetMaintenanceChat(id)
    const chats=chat?[chat]:await Promise.all([...live].map(async id=>{if(!maintenanceChatIdentity.has(id))await readChatReadonly(id);return maintenanceChatIdentity.get(id)}))
    return chats.filter(Boolean).some(current=>agentRegistry.get(current.sessionId)?.phase?.kind==='running'||settlementJobs.has(current.id)||spPostCommitJobs.has(current.sessionId)||spDatabase.isActive?.(current.id)||autoCompaction?.isActive(current.id)||candidateTasks.isActive(current)||sceneIllustrations?.isActive(current.id)||helperGenerations.busy(undefined,current.sessionId)||historyOperations.isRunning(current.sessionId)||Object.values(current.timeline?.participants||{}).some(p=>agentRegistry.get(p.sessionId)?.phase?.kind==='running'))
  }
  const capacitySettings=createCapacitySettings({store:profileData,active:capacityLimits,remoteUsage:()=>remoteCacheBudget.trim({dryRun:true}),diagnosticUsage:()=>createRollingDiagnosticStorage(profileData).usage(),readChats:async()=>{
    const rows=[];for(const row of (await readIndex()).chats||[]){const chat=await readChatReadonly(typeof row==='string'?row:row.id);if(chat)rows.push({tavernAudio:chat.tavernAudio,tavernScriptPrompts:chat.tavernScriptPrompts})}return rows
  }})
  const retentionScanner=createRetentionScanner()
  const toolWorkbench=createToolWorkbench({store:profileData,chatForSession:chatForSessionReadonly,updateChat,isBusy:retentionBusy,
    catalog:async sessionId=>[...new Map([...ctx.tools.schemas(),...(sessionId?ctx.tools.schemas(agentRegistry.get(sessionId)):[])].map(row=>[row.name,row])).values()]})
  ctx.effect(()=>()=>retentionScanner.dispose())
  const profileRetention=createProfileRetention({scanner:retentionScanner,dataRoot,commit:maintenanceGate.write,generation:maintenanceGate.revision,changeGeneration:maintenanceGate.changes,maintenance:maintenanceGate.runMaintenance,store:profileData,journal:chatJournalStore,backups:verifiedBackups,remoteCache:remoteCacheBudget,readIndex,isBusy:retentionBusy,sqlitePrune:spStorage.pruneSnapshots,removeChatReceipts:helperChatTransfer.removeChatReceipts,policy:retentionLimits})
  ctx.effect(()=>{const scheduler=createRetentionScheduler({run:profileRetention.run,generation:maintenanceGate.changes,subscribe:maintenanceGate.subscribe,onError:error=>console.warn('dsh-tavern: 保留策略清理未完成:',String(error.message||error))});return()=>scheduler.dispose()})
  async function dispatch(method, args) {
    performanceDiagnostics.browser(args?._performance)
    const started = performance.now()
    try { return await apiDiagnostics.observe(method, args, () => dispatchMethod(method, args)) }
    finally { performanceDiagnostics.record(method, performance.now() - started) }
  }

  const gameplayApi = createGameplayApi({
    controller: () => ctx.get('sessionController'), registry: agentRegistry, llm, dataRoot,
    store: profileData, dispatch: (method, args) => dispatchMethod(method, args),
    chatForSession, listCards,
    requests: async chat => (await modelRequestLog.evidence(chat.id)).requests,
    native: async id => {
      const live = sessionDebugEvidence(id)
      if (live.loaded) return live.events
      const handle = await agentRegistry.resume({ resumeSessionId: id })
      try { return sessionEvents(handle.agent.session) } finally { await handle.dispose() }
    },
    requiresBrowser: async chat => hasTavernScriptRuntime(chat, await effectiveHelperScripts(chat)),
    browserRuntimeReady: chat => tavernScriptDispatch.status(chat.sessionId).ready
  })

  const cardResponseTest = createCardResponseTest({ api: gameplayApi, store: profileData, chatForSession,selection:modelSelection,failedCases:retentionLimits.failedCases,
    ownerTurn:id=>sessionEvents(agentRegistry.get(id)?.session).filter(event=>event.type==='turn/start').at(-1)?.seq||0,
    onCreated:id=>responseTestSessions.add(id),onFinished:id=>{responseTestSessions.delete(id);modelRequestLog.release(id)} })
  ctx.effect(() => () => cardResponseTest.dispose())

  const tavernTrigger = createTavernTrigger({ foreground: profileSessionAccess.foreground, resolveAgent: resolveForegroundAgent })
  async function dispatchMethod(method, args) {
    if (method === 'getTavernBackgroundRetirementNotices'
      && Object.keys(args || {}).some(key => !['parentSessionId', '_performance'].includes(key))) {
      throw new Error('后台会话标注只能从宿主界面读取')
    }
    if(method==='cleanupRetention'){
      if(args?.scriptId||args?.owner||args?.scriptScope==='frame')throw Error('脚本不能执行数据清理')
      return profileRetention.run({dryRun:args?.dryRun!==false,only:args?.only})
    }
    if(deletingChatIds.size&&args?.sessionId){const chat=await conversationRegistry.resolve(args.sessionId,{readonly:true});if(chat&&deletingChatIds.has(chat.id)&&!['stopTavernHelperGeneration','cancelSceneImage'].includes(method))throw Error('对话正在删除')}
    if(method.startsWith('gameplay.')||['deleteChat','deleteChats','prepareDeleteChats','repairStoryAlignment','inspectStoryAlignment'].includes(method))return dispatchMethodGated(method,args)
    const gateOperation=method==='captureDisplayRuntime'||/^(?:get|list|poll|inspect|preview|export|parse|plan|browse)/.test(method)||(method==='doctorTavern'&&!args?.repair)?maintenanceGate.read:maintenanceGate.mutate
    return gateOperation(()=>args?.scriptScope==='frame'&&args.scriptId!=='__dsh_message__'?tavernScriptDispatch.runOwned(args.sessionId,args.runtimeId,()=>dispatchMethodGated(method,args),{method,scriptId:args.scriptId,token:args.spRecoveryToken,eventId:args.apiCallOrigin?.eventId||args.eventId}):dispatchMethodGated(method,args))
  }
  async function dispatchMethodGated(method, args) {
    if (method !== "doctorTavern" && args?.sessionId) await runtimeRecovery?.waitSession(args.sessionId)
    const framePermission = await authorizeScriptOperation(method,args || {},{assertOwner:assertHelperOwner,chatForSession,policy:scriptPolicy,isMvuCore:isSelectedMvuCore,onDenied:permissionDenials.record,isBoundWorldbook:async(chat,name)=>{
      const current=await worldBooks.boundCard(chat.cardPath,await readChatCard(chat),chat)
      if(name===current?.view.displayName)return true
      const binding=await worldBooks.binding(chat.cardPath),sourceKey=source=>source?.kind+':'+(source?.cardPath || source?.path || '')
      const sources=binding.kind==='multiple'?binding.books.map(book=>book.source):binding.source?[binding.source]:[]
      if(chat.tavernChatWorldbook?.source)sources.push(chat.tavernChatWorldbook.source)
      const row=await helperWorldbooks.locate(chat,name)
      return sources.some(source=>sourceKey(source)===sourceKey(row?.source))
    }})
    await profileSessionAccess.assertRpc(method, args)
    if(args?.sessionId&&['startTavernTrigger','gameplay.send','regenBody','rollbackTurn','saveBodyEdit','saveChat'].includes(method)&&(await chatForSessionReadonly(args.sessionId))?.pendingStoryAlignment)throw Error('剧情对账修复尚未完成，请先在状态恢复中重新检查并完成修复')
    if (method === 'startTavernTrigger') return tavernTrigger.start(args)
    // Reading the host's settings panel is passive. A card script using the
    // template API is an actual dependency and activates auto mode for this game.
    if(args?.scriptScope==='frame'&&/^(?:get|load|save)FullPromptTemplate(?:State|Globals|Settings|WorldInfo|Runtime)$/.test(method))await templateEngineStatus(args.sessionId,{api:true})
    if(method!=='getSpDatabase'&&!extensionRuntime.installed()&&(/^(?:get|list|save|delete|preview|apply|select|import|export|query|sync|run|update|fill|generate)Sp/.test(method)||['commitTavernScriptDatabase','fillTavernScriptDatabase'].includes(method)))throw new Error('SP·数据库扩展未安装或已停用，请在扩展程序中安装或启用。')
    if(args?.sessionId&&(/^(?:get|list|save|delete|preview|apply|select|import|export|query|sync|run|update|fill|generate|cancel)Sp/.test(method)||['commitTavernScriptDatabase','fillTavernScriptDatabase','tavernHelperDatabaseTemplates','spCompanionAction'].includes(method)))originalSpCatalog.assertBackend(args.sessionId,await chatForSessionReadonly(args.sessionId))
    if (method === 'inspectStoryAlignment' || method === 'repairStoryAlignment') {
      if(args?.scriptScope || args?.scriptId)throw Error('剧情对账只能从宿主设置界面操作')
      if(method==='repairStoryAlignment')return storyAlignment.repair(args?.chatId,args?.expectedStamp)
      const ids=args?.chatId?[args.chatId]:((await readIndex()).chats || []).map(row=>row.id)
      return {results:await Promise.all(ids.map(id=>storyAlignment.inspect(id).catch(error=>({chatId:id,status:'unknown',findings:[],error:String(error.message||error)}))))}
    }
    if (method === 'doctorTavern') {
      if (args?.scriptScope === 'frame') throw new Error('状态恢复只能从宿主设置界面操作')
      return await runtimeRecovery.run({ repair: args?.repair === true, chatId: args?.chatId })
    }
    if(method==='exportStorageDiagnostic'){
      if(args?.scriptScope||args?.scriptId)throw Error('存档诊断只能从宿主界面导出');
      return runtimeRecovery.exportDiagnostic(args?.chatId)
    }
    if(method==='acknowledgeRuntimeRecovery'){
      if(args?.scriptScope||args?.scriptId)throw Error('人工核对只能从宿主设置界面操作')
      return runtimeRecovery.acknowledge(args?.chatId,args?.expectedRevision)
    }
    if (method.startsWith('gameplay.')) return await gameplayApi.call(method.slice(9), args || {})
    switch (method) {
      case 'getToolWorkbench': return toolWorkbench.view(args?.sessionId,args?.mode)
      case 'saveToolWorkbench': return toolWorkbench.save(args||{})
      case 'previewToolWorkbenchImport': return toolWorkbench.preview(args?.document,args?.sessionId,args?.mode)
      case 'importToolWorkbench': return toolWorkbench.import(args||{})
      case 'exportToolWorkbench': return toolWorkbench.export()
      case 'getTavernConfirmationPreview':
      case 'issueTavernConfirmation':
      case 'executeTavernConfirmation': {
        if(args.scriptScope || args.scriptId) throw new Error('该操作只能在宿主确认界面执行')
        const preview = await confirmationPreview(args)
        if (method === 'getTavernConfirmationPreview') return preview
        if (preview.revision !== String(args.expectedRevision)) throw new Error('内容已变化，请重新查看后确认')
        if (method === 'issueTavernConfirmation') return oneTimeApprovals.issue(preview)
        if (preview.action === 'profile-confirm') return {userProfile:presentUserPreferenceProfile(await userPreferenceProfile.confirm({profileId:preview.target,draftRevision:Number(preview.revision),sessionId:preview.sessionId,approvalToken:args.approvalToken}))}
        const restored = await oneTimeApprovals.consume(args.approvalToken,preview,() => restoreApprovedCard(preview.target,preview.revision))
        return {...restored,card:{...cardPreparation.project(await readCard(preview.target)),path:preview.target}}
      }
      case 'getTavernCardPermissions': {
        if(args.scriptScope||args.scriptId)throw Error('资源授信只能从宿主界面查看')
        return resourcePermissionCatalog(args.sessionId,{currentOnly:args.currentOnly===true})
      }
      case 'changeTavernResourcePermissions': {
        if(args.scriptScope||args.scriptId)throw Error('资源授信只能由宿主界面设置')
        return changeResourcePermissions(args.sessionId,args.targets,args.capabilities)
      }
      case 'changeTavernCardPermissions': {
        if(args.scriptScope||args.scriptId)throw new Error('卡片权限只能由宿主界面确认')
        const chat=await chatForSession(args.sessionId);if(!chat)throw new Error('找不到当前游戏')
        const result=await cardPermissions.change(await cardSecurityIdentity(chat),args.expectedDigest,args.capabilities)
        frameResources.revoke(args.sessionId)
        sessionSignals.publish(args.sessionId,{kind:'tavern-state',version:'card-permissions:'+Date.now()});return result
      }
      case 'getTavernExtensions': return {extensions:extensionRuntime.status(),templateMigration:await originalSpCatalog.migrationStatus()}
      case 'previewTavernExtension': return extensionRuntime.preview(args.package)
      case 'getBundledTavernExtension': return extensionRuntime.preview(extensionRuntime.builtin())
      case 'exportTavernExtension': return {package:await extensionRuntime.export()}
      case 'checkTavernExtensionUpdate': return await extensionRuntime.check()
      case 'checkOriginalTavernExtensionUpdate': return await extensionRuntime.checkOriginal(args.ref||'main')
      case 'changeTavernExtension': {
        const extensionSessions=new Set([args.sessionId,...(await readIndex()).chats.map(chat=>chat.sessionId),...sessionSignals.snapshot().map(signal=>signal.sessionId)].filter(Boolean))
        if(spPostCommitJobs.size||[...extensionSessions].some(id=>agentRegistry.get(id)?.phase?.kind==='running'))throw new Error('请等当前生成和数据库任务结束后更新扩展')
        const result=await extensionRuntime.change(args.command,args.expectedRevision)
        const migration=await originalSpCatalog.initialize()
        for(const sessionId of extensionSessions)sessionSignals.publish(sessionId,{kind:'tavern-state',version:'extensions:'+result.extensions.revision})
        return {...result,templateMigration:migration}
      }
      case 'startTavernHelperGeneration': return await helperGenerations.start(args.sessionId, args.config, args.raw !== false, args.scriptId, args.expectedLifecycleRevision,{background:String(args.runtimeId||'').startsWith('background:'),runtimeId:args.runtimeId,eventId:args.apiCallOrigin?.eventId||args.eventId})
      case 'pollTavernHelperGeneration': return helperGenerations.poll(args.sessionId, args.id, args.scriptId, args.offset, args.expectedLifecycleRevision,{received:args.received,runtimeId:args.runtimeId})
      case 'stopTavernHelperGeneration': return helperGenerations.stop(args.sessionId, args.id, args.scriptId, args.expectedLifecycleRevision)
      case 'listTavernHelperModels': return await helperGenerations.models(args.api,args.sessionId,args.scriptId,args.expectedLifecycleRevision)
      case 'prepareTavernOriginalDatabaseMutation': {
        if(!extensionRuntime.usesOriginal(args.sessionId)||args.scriptId!=='extension-sp-database')throw Error('原版数据库尚未连接');await assertHelperOwner(args.sessionId,args.scriptId,args.expectedLifecycleRevision);
        return spDatabase.prepareOriginalMutation(args.sessionId,args.command,args.expectedRevision,args.original)
      }
      case 'beginTavernSpAuthority': return spAuthority.begin(args.sessionId,args)
      case 'chooseTavernSpAuthority': return spAuthority.choose(args.sessionId,args)
      case 'publishTavernSpAuthorityCache': return spAuthority.publishCache(args.sessionId,args)
      case 'commitTavernScriptDatabase': {
        if(extensionRuntime.usesOriginal(args.sessionId)&&args.scriptId!=='extension-sp-database')throw Error('表格写入需要通过原版数据库窗口');
        if(originalSpCatalog.owns())originalSpCatalog.assertAvailable(args?.sessionId)
        return await scriptServices.commit(args?.sessionId, args.command, args.expectedRevision, args.expectedLifecycleRevision)
      }
      case 'tavernHelperDatabaseTemplates': {
        await assertHelperOwner(args.sessionId,args.scriptId,args.expectedLifecycleRevision);if(!extensionRuntime.installed())throw new Error('SP·数据库未安装');
        const operation=args.operation||{};
        if(originalSpCatalog.owns()){
          originalSpCatalog.assertAvailable(args.sessionId)
          if(args.scriptId==='extension-sp-database'&&operation.kind==='migration-status')return {migration:await originalSpCatalog.migrationStatus()}
          if(args.scriptId==='extension-sp-database'&&operation.kind==='migration-default-applied'){await originalSpCatalog.acknowledgeDefault(operation.name);return {success:true}}
          if(operation.kind==='list'){const templates=await originalSpCatalog.list();return {owner:'original',names:templates.map(t=>t.name),...(operation.includeData?{templates}:{})}}
          throw new Error('原版 SP 模板操作需要已就绪的原版窗口，旧库只读')
        }
        const templates=await spTemplates.list();
        if(operation.kind==='list')return {names:templates.map(t=>t.name),...(operation.includeData?{templates}: {})};
        if(operation.kind==='import'){
          if(operation.scope==='global'){const result=await spTemplates.save({name:operation.name,data:operation.data,withData:false});return {success:true,names:result.templates.map(t=>t.name)}}
          if(operation.scope!=='chat')throw new Error('模板作用域必须是 chat 或 global');
          const data=importSpTemplate(operation.data,{withData:false}).data,result=await scriptServices.commit(args.sessionId,{kind:'template',data,name:operation.name||'状态栏模板',mode:'preserve'},args.expectedRevision,args.expectedLifecycleRevision);return {success:true,...result}
        }
        if(operation.kind==='select'){const template=templates.find(t=>t.name===operation.name);if(!template)throw new Error('模板不存在');if(operation.scope==='global'){await spTemplates.select(template.id);return {success:true,names:templates.map(t=>t.name)}}if(operation.scope==='chat'){const result=await scriptServices.commit(args.sessionId,{kind:'template',data:template.data,name:template.name,id:template.id,mode:'preserve'},args.expectedRevision,args.expectedLifecycleRevision);return {success:true,...result}}}
        throw new Error('模板操作无效');
      }
      case 'tavernHelperChatFiles': return {value:await helperChatFiles.perform(args.sessionId,args.operation,args.scriptId,args.expectedLifecycleRevision)}
      case 'tavernScriptImages': return scriptImages.perform(args.sessionId,args.operation,args.scriptId,args.expectedLifecycleRevision)
      case 'tavernScriptFiles': return await scriptServices.files(args?.sessionId, args.operation, args.scriptId, args.expectedLifecycleRevision)
      case 'tavernScriptStorage': return scriptServices.storage(args.sessionId, args.operation, args.scriptId, args.expectedLifecycleRevision)
      case 'tavernHelperBrowserCache': return scriptServices.storage(args.sessionId,args.operation || {kind:'read'},args.scriptId,args.expectedLifecycleRevision)
      case 'fillTavernScriptDatabase': return scriptServices.fill(args.sessionId, args.expectedLifecycleRevision)
      case 'getTavernScriptResource': return scriptAssets.read(args.sessionId, args.digest,args.scriptScope === 'frame' && !(await scriptPolicy(await chatForSessionReadonly(args.sessionId),args.scriptId)).capabilities.includes('shared-resources') ? args.scriptId : undefined)
      case 'tavernHelperIzumiConnection': {
        if(args.command.kind==='read'){
          const config=await izumiConnection.read(args.sessionId)
          if(args.scriptScope==='frame'&&!framePermission?.trustedCardMode&&!framePermission?.capabilities?.includes('shared-resources')){
            // Match the existing native-preset connection envelope projection.
            for(const field of ['apiUrl','includeHeaders','includeBody','excludeBody'])delete config[field]
          }
          return {config}
        }
        await assertHelperOwner(args.sessionId,args.scriptId,args.expectedLifecycleRevision);
        if(args.command.kind==='secret')return izumiConnection.saveSecret(args.sessionId,args.command.value,args.command.label,args.scriptId,args.expectedLifecycleRevision);
        if(args.command.kind==='secrets')return izumiConnection.listSecrets(args.sessionId,args.scriptId,args.expectedLifecycleRevision);
        if(args.command.kind==='delete-secret')return izumiConnection.deleteSecret(args.sessionId,args.command.id,args.scriptId,args.expectedLifecycleRevision);
        if(args.command.kind==='reset')return izumiConnection.reset(args.sessionId,args.scriptId,args.expectedLifecycleRevision);
        if(args.command.kind==='models')return izumiConnection.models(args.sessionId,args.command.config,args.scriptId,args.expectedLifecycleRevision);
        return izumiConnection.mutate(args.sessionId,args.command.config,args.scriptId,args.expectedLifecycleRevision);
      }
      case 'tavernHelperPresets': {
        const scope={currentOnly:false,omitSensitive:args.scriptScope==='frame'&&!framePermission?.trustedCardMode&&!framePermission?.capabilities?.includes('shared-resources')};
        if(args.command?.kind==='native-catalog')return {catalog:await nativePresets.catalog(args.sessionId,scope)};
        if(args.command?.kind==='native-read-all')return nativePresets.readAll(args.sessionId,scope);
        if(args.command?.kind==='native-read')return {preset:await nativePresets.read(args.sessionId,args.command.name,scope)};
        if(args.command?.kind?.startsWith('native-'))return nativePresets.mutate(args.sessionId,args.command,args.scriptId,args.expectedLifecycleRevision);
        if(args.command?.kind==='read')return {presets:await helperPresets.read(args.sessionId,scope)};
        const result=await helperPresets.mutate(args.sessionId,args.command,args.scriptId,args.expectedLifecycleRevision);
        if(args.command.kind==='load')result.context=projectTavernHelperContext(await chatForSession(args.sessionId));return result;
      }
      case 'tavernHelperIzumiAdvice': {
        const chat=await assertHelperOwner(args.sessionId,args.scriptId,args.expectedLifecycleRevision);
        if(typeof args.enabled!=='boolean')throw new Error('Advice 开关值无效');
        const config=args.config||{};if(!['head','tail'].includes(config.position||'tail'))throw new Error('Advice 位置无效');
        const advice={enabled:args.enabled,position:config.position||'tail',stripModelAdvice:config.stripModelAdvice!==false,displayAdviceForUser:config.displayAdviceForUser===true};
        await updateChat(chat.id,current=>{if(current.tavernHelperLifecycleRevision!==chat.tavernHelperLifecycleRevision)throw new Error('本局已变化');current.presetControls={...current.presetControls,advice:args.enabled,adviceConfig:advice,version:Number(current.presetControls?.version||0)+1};return current},{source:'izumi.advice'});return {advice};
      }
      case 'editTavernRuntimeScripts': return await scriptLibrary.runtimeEdit(args.sessionId, args.command, args.expectedLifecycleRevision, args.scriptId, {ownMetadataOnly:args.scriptScope==='frame'&&!framePermission?.capabilities?.includes('shared-resources')})
      case 'getTavernRemoteDependencyStatus':
      case 'cancelTavernRemoteDependencies':
      case 'refreshTavernRemoteDependencies': {
        if(args?.scriptScope || args?.scriptId || args?.owner)throw Error('请在宿主脚本管理中重新解析远程依赖')
        const sessionId=str(args?.sessionId),chat=await profileSessionAccess.foreground(sessionId)
        const previous=remoteRefreshJobs.get(sessionId)
        if(method==='getTavernRemoteDependencyStatus')return previous?.progress || {stage:'idle'}
        if(method==='cancelTavernRemoteDependencies'){previous?.controller.abort();return {cancelled:!!previous}}
        if(previous)throw Error('正在重新解析远程依赖')
        const ready=async()=>{if((await sessionActivity(sessionId))?.busy || agentRegistry.get(sessionId)?.phase?.kind==='running')throw Error('请等待当前生成和后台任务完成后再更新依赖')}
        await ready()
        const controller=new AbortController(),job={controller,progress:{stage:'resolving'}}
        remoteRefreshJobs.set(sessionId,job)
        try {
          const cardExtensions=await readCardExtensions(chat.cardPath),scripts=resolveTavernScripts(chat,cardExtensions?.helperScripts)
          const extensions={helperScripts:[...await extensionRuntime.scripts(sessionId),...cardOwnedScripts(scripts.scripts)],regexScripts:[...(cardExtensions?.regexScripts||[]),...(effectiveGamePreset(chat)?.regexScripts||[])]}
          const result=await tavernRemoteAssets.refreshExtensions(extensions,{signal:controller.signal,beforeCommit:ready,onProgress:row=>{job.progress={stage:row.stage,failedCount:row.failedCount||0,url:row.url||''}}})
          if(result.status==='completed'){
            const saved=await updateChat(chat.id,current=>{current.tavernHelperLifecycleRevision=Number(current.tavernHelperLifecycleRevision||0)+1;return current},{source:'scripts.remote-refresh'})
            sessionSignals.publish(sessionId,{kind:'tavern-state',version:'remote:'+saved.tavernHelperLifecycleRevision})
          }
          return {status:result.status,diagnostics:result.diagnostics,pins:result.pins}
        } finally {if(remoteRefreshJobs.get(sessionId)===job)remoteRefreshJobs.delete(sessionId)}
      }
      case 'getTavernScriptLibrary': {
        const library = await scriptLibrary.get(args?.sessionId,{includeApplyStatus:args?.includeApplyStatus===true&&!args?.scriptScope&&!args?.scriptId})
        return args?.scriptScope === 'frame' && !framePermission?.capabilities?.includes('shared-resources')
          ? projectScriptLibraryForFrame(library, args.scriptId) : library
      }
      case 'changeTavernScriptLibrary': {
        if([args.trustResourceIds,args.revokeTrustResourceIds,args.confirmedUpdateIds].some(ids=>ids?.length) && (args.scriptScope||args.scriptId))throw Error('导入授信和更新目标只能由宿主界面确认')
        const result=await scriptLibrary.change(args?.sessionId,args.command,args.expectedRevision,{confirmedUpdateIds:args.confirmedUpdateIds})
        const trust = new Set(args.trustResourceIds || []), revoke = new Set(args.revokeTrustResourceIds || [])
        for(const script of flattenScriptTrees(result.library[args.command.scope])) {
          if(revoke.has(script.id))await cardPermissions.changeResource('script',script._dshResourceId,[])
          else if(trust.has(script.id))await cardPermissions.changeResource('script',script._dshResourceId,COMPATIBILITY_CAPABILITIES)
        }
        if(trust.size || revoke.size) frameResources.revokeAll()
        sessionSignals.publish(args.sessionId,{kind:'tavern-state',version:'scripts:'+result.lifecycleRevision+':'+result.revision});return result
      }
      case 'applyTavernScriptLibrary': { const result=await scriptLibrary.apply(args?.sessionId,args.expectedLifecycleRevision,{expectedLibraryRevision:args?.expectedLibraryRevision});sessionSignals.publish(args.sessionId,{kind:'tavern-state',version:'scripts:'+result.lifecycleRevision+':'+result.revision});return result }
      case 'planTavernGithubImport': {
        if(args?.scriptScope==='frame')throw Error('仓库安装只能从宿主脚本管理界面操作');
        const imported=await fetchGithubScript(args.repository,args.ref);
        return {...await scriptLibrary.planImport(args.sessionId,args.scope,[imported.script],imported.script.name,args.existing,'github:'+imported.provenance.repository),github:imported.provenance,modules:imported.modules};
      }
      case 'selectTavernFrontendWorldInfo': {const chat=await chatForSessionReadonly(args.sessionId);if(!chat)throw Error('当前会话不存在');return selectFrontendWorldInfo(args.input,chat,effectiveGamePreset(chat)?.compatibilityPresetDocument||{});}
      case 'startTavernFrontendMainGeneration': return helperGenerations.start(args.sessionId,frontendMainGenerationConfig(args.body),true,args.scriptId,args.expectedLifecycleRevision,{exactMessages:true,background:String(args.runtimeId||'').startsWith('background:'),runtimeId:args.runtimeId,eventId:args.apiCallOrigin?.eventId||args.eventId});
      case 'startTavernFrontendGeneration': return helperGenerations.start(args.sessionId,frontendGenerationConfig(args.body),true,args.scriptId,args.expectedLifecycleRevision,{exactMessages:true,background:String(args.runtimeId||'').startsWith('background:'),runtimeId:args.runtimeId,eventId:args.apiCallOrigin?.eventId||args.eventId});
      case 'planTavernScriptUpdate': return await scriptLibrary.planImport(args?.sessionId,args.scope,args.document,args.name,args.existing,undefined,args.selections)
      case 'parseTavernScriptImport': return { trees: importScriptTrees(args.document, args.name) }
      case 'getMigrationConfiguration': return { configuration: {...await migrationSettings.read(),...(originalSpCatalog.owns()?{templates:await originalSpCatalog.list(),templateOwner:'original'}:{})} }
      case 'importMigrationConfiguration': {
        const prepared = prepareTextImport(args?.payload, '导入文件为空')
        return { imported: await migrationSettings.import(JSON.parse(prepared.text), prepared.name) }
      }
      case 'exportSpCheckpoint': {const chat=await chatForSessionReadonly(args.sessionId);if(!chat)throw new Error('当前会话不存在');return {checkpoint:exportSpCheckpoint(databaseState(chat))}}
      case 'getGamePresetControls': {
        const chat = await chatForSessionReadonly(args?.sessionId)
        if (!chat || groupOfMode(chat.mode) !== 'play') throw new Error('请先进入一局游玩对话')
        return { controls: gamePresetControls(chat) }
      }
      case 'changeGamePresetControls': {
        const chat = await chatForSession(args?.sessionId)
        if (!chat || groupOfMode(chat.mode) !== 'play') throw new Error('请先进入一局游玩对话')
        await updateChat(chat.id, current => {
          if (args.expectedVersion !== gamePresetControls(current).version) throw new Error('本局设置已变化，请刷新后重试')
          if (Object.values(current.timeline?.operations || {}).some(op => op.kind === 'body' && op.status === 'running')) throw new Error('请等本轮正文生成结束后再修改预设')
          return changeGamePreset(current, args.operation)
        }, { source: 'preset-controls.change' })
        return { controls: gamePresetControls(await chatForSessionReadonly(args.sessionId)) }
      }
      case 'listSpConfigurations': return await spConfigurations.list()
      case 'saveSpPlotPreset': return await spConfigurations.save(args)
      case 'deleteSpPlotPreset': return await spConfigurations.remove(args?.id)
      case 'saveSpDatabaseDefaults': return await spConfigurations.defaults(args?.settings)
      case 'previewSpPlot': { const chat = await chatForSession(args?.sessionId); if (!chat) throw new Error('请先进入一局游玩'); return { database: await spDatabase.previewPlot(args.sessionId, args.userText, await readChatCard(chat)) } }
      case 'cancelSpPlot': return await spDatabase.cancelPlot(args?.sessionId)
      case 'listSpTemplates': return { templates:originalSpCatalog.owns()?await originalSpCatalog.list():await spTemplates.list(),owner:originalSpCatalog.owns()?'original':'dsh' }
      case 'saveSpTemplate': return await spTemplates.save(args)
      case 'previewSpChatTemplate': {
        if(originalSpCatalog.owns())throw new Error('请在原版 SP 模板目录预览与切换模板')
        const template=(await spTemplates.list()).find(t=>t.id===args.id);if(!template)throw new Error('模板不存在');
        const database=await spDatabase.read(args.sessionId),result=planSpTemplateChange(database.data,template.data,database.locks,args.mode||'preserve');
        return {preview:{id:template.id,name:template.name,updatedAt:template.updatedAt,basis:database.basis,mode:args.mode||'preserve',summary:result.summary,archived:result.archived}};
      }
      case 'applySpChatTemplate': {
        if(originalSpCatalog.owns())throw new Error('请在原版 SP 模板目录切换模板')
        const template=(await spTemplates.list()).find(t=>t.id===args.id);if(!template)throw new Error('模板不存在');
        if(template.updatedAt!==args.updatedAt)throw new Error('模板已变化，请重新预览');
        return {database:await spDatabase.update(args.sessionId,{kind:'template',id:template.id,name:template.name,updatedAt:template.updatedAt,data:template.data,mode:args.mode||'preserve'},args.expectedRevision)};
      }
      case 'selectSpTemplate': return await spTemplates.select(args?.id)
      case 'deleteSpTemplate': return await spTemplates.remove(args?.id)
      case 'importSpTableData': {
        const imported = importSpTemplate(args?.data, { withData: true })
        return { database: await spDatabase.update(args?.sessionId, { kind: 'import', data: imported.data }, args.expectedRevision), repairs: imported.repairs }
      }
      case 'querySpDatabase': return await spDatabase.query(args?.sessionId, args.sql, args.parameters)
      case 'saveSpCompanionDefaults': return await spCompanion.defaults(args?.sessionId)
      case 'getSpCompanion': return await spCompanion.get(args?.sessionId)
      case 'spCompanionAction': return { database: await spCompanion.action(args?.sessionId, args.action) }
      case 'getSpCompanionImage': return await spCompanion.asset(args?.sessionId, args.id)
      case 'saveSpImageCredentials': return await spCompanion.imageCredentials(args?.sessionId, args.key)
      case 'getSpDashboard': return await spAdvanced.inspect(args?.sessionId)
      case 'syncSpFillWorldbook': { const result=await spFillWorldbook.sync(args.sessionId);return {...result,database:await spDatabase.read(args.sessionId)} }
      case 'getSpFillWorldbooks': { const chat=await chatForSessionReadonly(args.sessionId);if(!chat)throw new Error('请先进入游玩');return {books:await spFillBooks.catalog(chat),entries:await spFillBooks.entries(chat,args.scope)} }
      case 'saveSpServiceCredentials': return { credentials: await spAdvanced.credentials(args?.patch, args?.sessionId) }
      case 'runSpAdvanced': return { database: await spAdvanced.task(args?.sessionId, args.kind, args.payload) }
      case 'cancelSpAdvanced': return await spDatabase.cancel(args?.sessionId)
      case 'getSpDatabase': return { database: {...await extensionRuntime.readCache(args?.sessionId),authority:await spAuthority.read(args.sessionId)} }
      case 'updateSpDatabase': return { database: await spDatabase.update(args?.sessionId, args.command, args.expectedRevision) }
      case 'fillSpDatabase': return { database: await spDatabase.fill(args?.sessionId) }
      case 'cancelSpDatabaseFill': return await spDatabase.cancel(args?.sessionId)
      case 'generateSpInspiration': return { database: await spDatabase.inspire(args?.sessionId, args.prompt) }
      case 'cancelSpInspiration': return await spDatabase.cancelInspiration(args?.sessionId)
      case 'listCards': return { cards: await listCards() }
      case 'getLatestRequestContext': {
        const sessionId = str(args?.sessionId)
        const background = backgroundAgentRunner.requestContext(sessionId)
        const session = sessionStore.get(sessionId) || agentRegistry.get(sessionId)?.session
        const ownerId = background?.parentSessionId || session?.header?.parentSession || sessionId
        const chat = await chatForSession(ownerId)
        return { record: await modelRequestLog.latestForSession(sessionId, chat?.id) }
      }
      case 'getCardOrganization': return {groups:(await cardOrganization.read()).groups}
      case 'organizeCards': return {groups:(await cardOrganization.update(args || {}, await fileResources.list('card'))).groups}
      case 'getUpdateStatus': return { status: await applicationUpdater.status() }
      case 'checkUpdate': return { status: await applicationUpdater.check() }
      case 'startUpdate': return { status: await applicationUpdater.start() }
      case 'prepareSessionOpening': {
        const chat = await chatForSession(args && args.sessionId)
        if (!chat) throw new Error('找不到原对话')
        return await prepareSessionOpening({ chat, card: await readChatCard(chat), swipeId: args.swipeId, message: args.message, preparation: openingPreparation })
      }
      case 'generateTavernHelperRaw': {
        const chat = await chatForSession(args && args.sessionId)
        if (!chat) throw new Error('找不到当前游戏')
        return { text: await generateHelperRaw(args.config, { promptLimits:capacityLimits.prompts,callModel, sessionId: chat.sessionId,
          history: projectTavernHelperContext(chat).messages.map(message => ({ role: message.role, text: message.message })) }) }
      }
      case 'callOpeningRuntime': return await openingPreparation.callRuntime(args && args.id, args && args.method, args && args.args, args && args.openingId)
      case 'saveOpeningSelection': return openingPreparation.select(args && args.id, args && args.openingId)
      case 'createOpeningPreparation': return await openingPreparation.create(args && args.path)
      case 'releaseOpeningPreparation': return openingPreparation.release(args && args.id)
      case 'getOpeningPreparation': return openingPreparation.get(args && args.id)
      case 'replaceOpeningWorldbook': return await openingPreparation.replaceWorldbook(args && args.id, args && args.entries, args && args.expectedEntries)
      case 'getCardOpenings': return await getCardOpenings(args && args.path, args && args.userName, args && args.requestMode, args?.openingDataVersion)
      case 'preparePlayStart': {
        await runtimePresets.prepareFullSnapshot()
        return { prepared: true }
      }
      case 'getUserPreferenceProfile': {
        const chat = await chatForSession(args && args.sessionId)
        return {
          userProfile: presentUserPreferenceProfile(await userPreferenceProfile.read()),
          currentConversation: chat && groupOfMode(chat.mode) === 'play' ? {
            enabled: chat.userProfileEnabled === true,
            profileId: chat.userProfileId || 'default',
            revision: Math.max(0, Number(chat.userProfileRevision) || 0)
          } : null
        }
      }
      case 'manageUserPreferenceProfile': return { userProfile: presentUserPreferenceProfile(await userPreferenceProfile.manage(args)) }
      case 'updateUserPreferenceProfile': return { userProfile: presentUserPreferenceProfile(await userPreferenceProfile.updateConfirmed(args)) }
      case 'setConversationUserProfileEnabled': {
        const sessionId = str(args?.sessionId)
        const chat = await chatForSession(sessionId)
        if (!chat || groupOfMode(chat.mode) !== 'play') throw new Error('请先打开游玩会话')
        if (typeof args.enabled !== 'boolean') throw new Error('画像开关必须为布尔值')
        if ((await sessionActivity(sessionId))?.busy || agentRegistry.get(sessionId)?.phase?.kind === 'running') throw new Error('请等待当前生成和后台任务完成后再切换画像')
        const patch = await playCardSnapshots.preferenceReplacement(chat, args.enabled, args.profileId)
        const saved = Object.keys(patch).length ? await updateChat(chat.id, current => {
          if (current._storageRevision !== chat._storageRevision || Number(current.cardContextRevision || 0) !== Number(chat.cardContextRevision || 0) || current.cardContextSnapshot !== chat.cardContextSnapshot || current.userProfileEnabled !== chat.userProfileEnabled) throw new Error('当前游戏配置已变化，请刷新后重试')
          return Object.assign(current, patch)
        }, { source: 'user-profile.toggle-conversation' }) : chat
        return { userProfile: presentUserPreferenceProfile(await userPreferenceProfile.read()), currentConversation: {
          enabled: saved.userProfileEnabled === true, profileId: saved.userProfileId || 'default', revision: Math.max(0, Number(saved.userProfileRevision) || 0)
        } }
      }
      case 'setUserPreferenceProfileDefaultEnabled': return { userProfile: presentUserPreferenceProfile(await userPreferenceProfile.setDefaultEnabled(args && args.enabled === true, args?.profileId)) }
      case 'getCard': {
        const cardPath = await fileResources.canonicalPath(args && args.path, 'card')
        const workspace = await readCardWorkspace(cardPath)
        if (workspace === undefined) throw new Error('人物卡不存在: ' + cardPath)
        return { card: Object.assign(cardPreparation.present({ card: workspace, as: 'detail' }), { path: cardPath }) }
      }
      case 'getCardTaskPrompt': {
        const task = str(args && args.task)
        const promptName = cardTaskPrompts[task]
        if (promptName === undefined) throw new Error('未知卡片任务: ' + task)
        const chat = await chatForSession(args && args.sessionId)
        let legacyWorkspaceText = ''
        if (task === 'edit' && chat?.cardEditContext?.version === 1) {
          const target = await waitForWritableSession({ registry: agentRegistry, sessions: sessionStore, sessionId: chat.sessionId, sleep })
          legacyWorkspaceText = await ensureNativeCardWorkspace(target.session, chat)
        }
        return { task, text: runtimePrompt(promptName), legacyWorkspaceText }
      }
      case 'getResourceWorkspace': return { path: dataRoot + '/resources' }
      case 'listResources': return await listTavernResources()
      case 'getResource': {
        const resourcePath = await fileResources.canonicalPath(args && args.path, 'source')
        const text = await fileResources.readText(resourcePath)
        if (text === undefined) throw new Error('剧本不存在: ' + resourcePath)
        return { path: resourcePath, text }
      }
      case 'getGlobalWorldBooks': return await helperWorldbooks.globalCatalog()
      case 'setGlobalWorldBooks': return await helperWorldbooks.setGlobal(args.sources,args.expectedRevision)
      case 'listWorldBooks': return await worldBooks.catalog()
      case 'getWorldBook': return await worldBooks.get(args && args.source)
      case 'getWorldBookBinding': return { binding: await worldBooks.binding(args && args.cardPath) }
      case 'getWorldBookAssociations': return { associations: await worldBooks.associations(args && args.source) }
      case 'bindWorldBook': return { binding: await worldBooks.bind(args && args.cardPath, args && args.source) }
      case 'setWorldBookBindings': return { binding: await worldBooks.setBindings(args && args.cardPath, args && args.sources) }
      case 'unbindWorldBook': return { binding: await worldBooks.unbind(args && args.cardPath, args && args.source) }
      case 'importWorldBook': return { worldBook: await worldBooks.import(args && args.payload) }
      case 'updateWorldBook': return await worldBooks.update(args && args.source, args && args.update)
      case 'exportWorldBook': return { worldBook: await worldBooks.export(args && args.source) }
      case 'deleteWorldBook': return await worldBooks.remove(args && (args.source || args.path))
      case 'listPresets': return await presetLibrary.catalog()
      case 'selectPreset': return await presetLibrary.select(args && args.path)
      case 'applyConversationPreset': {
        const sessionId = str(args?.sessionId)
        const chat = await chatForSession(sessionId)
        if (!chat || groupOfMode(chat.mode) !== 'play') throw new Error('请先打开游玩会话')
        if (typeof args.path !== 'string') throw new Error('请选择预设')
        if ((await sessionActivity(sessionId))?.busy || agentRegistry.get(sessionId)?.phase?.kind === 'running') throw new Error('请等待当前生成和后台任务完成后再应用预设')
        // All UI entry points share the same script, preset and lifecycle transaction.
        const result = await playManagement.apply(sessionId, { kind: 'preset', path: args.path }, args.expectedRevision===undefined?Number(chat.playConfigRevision)||0:Number(args.expectedRevision))
        const saved = await chatForSession(sessionId)
        return { presetSwitch:result.presetSwitch, runtimePreset: saved.runtimePresetSnapshot === null ? null : { id: saved.runtimePresetSnapshot.presetPath, name: saved.runtimePresetSnapshot.presetName } }
      }
      case 'getPreset': return { preset: await presetLibrary.detail(args && args.path) }
      case 'exportPreset': return await presetLibrary.export(args && args.path)
      case 'movePresetEntry': return { preset: await presetLibrary.moveEntry(args?.path, args?.entryKey, args?.phase, args?.beforeEntryKey, args?.revision) }
      case 'updatePresetEntry': return { preset: await presetLibrary.updateEntry(args && args.path, args && args.entryKey, args && args.patch) }
      case 'updatePresetRegex': return { preset: await presetLibrary.updateRegex(args && args.path, args && args.regexKey, args && args.patch !== undefined ? args.patch : args && args.enabled) }
      case 'previewPresetConversion': {
        const preview = await previewPreset(args && args.path, args && args.orderGroupIndex)
        if (preview === undefined) throw new Error('预设不存在: ' + (args && args.path))
        return { preview }
      }
      case 'extractBypassPlan': {
        return { plan: await bypassPlans.extract({
          id: args && args.id,
          name: args && args.name,
          sourcePresetPath: args && args.sourcePresetPath,
          entryKeys: args && args.entryKeys,
          regexKeys: args && args.regexKeys,
          compatibleModels: args && args.compatibleModels
        }) }
      }
      case 'activateBypassPlan': {
        await bypassPlans.activate(args && args.id || '')
        return { activePlanId: args && args.id || '' }
      }
      case 'getBypassPlan': return { plan: await bypassPlans.get(args && args.id) }
      case 'importBypassPlan': {
        const payload = args && args.payload && typeof args.payload === 'object' ? args.payload : {}
        const text = str(payload.text)
        if (text.trim() === '') throw new Error('旧版预设条目配置文件为空')
        let document
        try { document = JSON.parse(text) } catch { throw new Error('旧版预设条目配置文件不是有效的 JSON') }
        return { plan: await bypassPlans.importPackage(document) }
      }
      case 'exportBypassPlan': {
        const document = await bypassPlans.exportPlan(args && args.id)
        const safeName = str(document.plan && document.plan.name || '预设条目配置').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || '预设条目配置'
        return { name: safeName + '.dsh-bypass-plan.json', text: JSON.stringify(document, null, 2) }
      }
      case 'toggleBypassPlanEntry': {
        await bypassPlans.toggleEntry({ id: args && args.id, entryKey: args && args.entryKey, enabled: args && args.enabled === true })
        return { plan: await bypassPlans.get(args && args.id) }
      }
      case 'toggleBypassPlanRegex': {
        await bypassPlans.toggleRegex({ id: args && args.id, regexKey: args && args.regexKey, enabled: args && args.enabled === true })
        return { plan: await bypassPlans.get(args && args.id) }
      }
      case 'setBypassPlanCompatibleModels': return { plan: await bypassPlans.setCompatibleModels({ id: args && args.id, compatibleModels: args && args.compatibleModels }) }
      case 'renameBypassPlan': return { plan: await bypassPlans.rename(args && args.id, args && args.name) }
      case 'copyBypassPlan': return { plan: await bypassPlans.copy(args && args.id, args && args.name) }
      case 'deleteBypassPlan': {
        await bypassPlans.remove(args && args.id)
        return { deleted: true }
      }
      case 'renameResource': return { resource: await renameResource(args && args.path, args && args.name) }
      case 'deleteResource': return await deleteResource(args && args.path)
      case 'deletePreset': return await deletePreset(args && args.path)
      case 'getScriptInfo': {
        const script = await readScript(args && args.path)
        const info = scriptContinuity.inspect({ script: script, state: null, request: { kind: 'info' } })
        return { script: script === undefined ? info : Object.assign({}, info, { path: script.path }) }
      }
      case 'importScript': return { script: await importScript(args && args.cardPath, args && args.payload) }
      case 'bindScript': return { script: await bindScript(args && args.cardPath, args && args.path) }
      case 'deleteScript': return await deleteScript(args && (args.cardPath || args.path))
      case 'importSource': return { source: await importSource(args && args.payload) }
      case 'importPreset': {
        if(args?.trustResource && (args.scriptScope||args.scriptId))throw Error('导入授信只能由宿主界面设置')
        const preset=await importPreset(args && args.payload)
        await cardPermissions.changeResource('preset',preset.path,args?.trustResource?COMPATIBILITY_CAPABILITIES:[])
        return {preset}
      }
      case 'updateCard': {
        const change = await updateCard(args && args.path, args && args.patch, args?.revision, args?.rawOperations)
        return { card: change.card, changed: change.changed }
      }
      case 'getCapacitySettings': return capacitySettings.status()
      case 'saveCapacitySettings': {
        if(args?.scriptScope==='frame'||args?.scriptId)throw Error('容量设置请从宿主设置界面修改')
        return capacitySettings.save(args.settings)
      }
      case 'getCandidatePreferences': return {candidateDismissMode:(await readTavernSettings()).candidateDismissMode}
      case 'getBackgroundScriptGeneration': {
        if(args?.scriptScope||args?.scriptId)throw Error('后台脚本控制只能在宿主设置中使用')
        const library=await scriptLibrary.get(args?.sessionId),scripts=new Map()
        for(const trees of Object.values(library.library))for(const script of flattenScriptTrees(trees))scripts.set(script.id,{id:script.id,name:script.name})
        for(const script of extensionRuntime.scripts(args?.sessionId))scripts.set(script.id,{id:script.id,name:script.name})
        return {policy:(await readTavernSettings()).backgroundScriptGeneration,scripts:[...scripts.values()],sessions:(await readIndex()).chats.filter(chat=>['story','script'].includes(chat.mode||'story')).map(chat=>({sessionId:chat.sessionId,title:chat.title||chat.cardName||chat.id})),jobs:await helperGenerations.list(args?.sessionId)}
      }
      case 'stopBackgroundScriptGeneration': {
        if(args?.scriptScope||args?.scriptId)throw Error('后台脚本控制只能在宿主设置中使用')
        const job=(await helperGenerations.list(args?.sessionId)).find(job=>job.id===args?.id)
        if(!job)return {stopped:false}
        return helperGenerations.stop(job.scope.sessionId,job.id,job.scriptId,job.scope.lifecycleRevision)
      }
      case 'recoverScriptGeneration': {
        if(args?.scriptScope||args?.scriptId)throw Error('生成结果核对只能在宿主设置中使用')
        return helperGenerations.recovery(args.sessionId,args.id,{reviewed:args.reviewed===true})
      }
      case 'getDisplayPreferences': return { hideContextAndReasoning: (await readTavernSettings()).hideContextAndReasoning }
      case 'getTavernSettings': {const settings=await readTavernSettings();return {writingSkills:await writingSkillsFor({disabledWritingSkills:settings.defaultDisabledWritingSkills}),settings,modelCatalog:await tavernModelCatalog(),releaseCapabilities:TAVERN_RELEASE_CAPABILITIES}}
      case 'getSceneImageSettings': return { settings: await enabledSceneIllustrations().settings(args?.provider) }
      case 'saveSceneImageSettings': return { settings: await enabledSceneIllustrations().configure(args) }
      case 'testSceneImageConnection': return await enabledSceneIllustrations().testConnection(args)
      case 'listSceneImageModels': return await enabledSceneIllustrations().listModels(args)
      case 'sceneImageStatus': return { illustration: await enabledSceneIllustrations().status(args.sessionId, args.turn) }
      case 'recordSceneImageInteraction': {
        const chat = await chatForSession(str(args.sessionId))
        if (chat) await recordSceneImageInteraction(sceneDiagnostics, chat.id, args).catch(() => {})
        return { recorded: Boolean(chat) }
      }
      case 'generateSceneImage': {
        const chat = await chatForSession(str(args.sessionId))
        const record = (stage, reason) => recordSceneImageInteraction(sceneDiagnostics, chat?.id, { requestId: args.requestId, turn: args.turn, stage, reason }).catch(() => {})
        await record('received')
        try {
          const illustration = await enabledSceneIllustrations().start(args.sessionId, args.turn, args.key, args)
          await record('returned')
          return { illustration }
        } catch (error) { await record('failed', 'start-error'); throw error }
      }
      case 'retrySceneImageSave': return { illustration: await enabledSceneIllustrations().retrySave(args.sessionId, args.turn, args.key, args.requestId) }
      case 'cancelSceneImage': return { illustration: await enabledSceneIllustrations().cancel(args.sessionId, args.turn, args.key, args.requestId) }
      case 'removeSceneImage': return { illustration: await enabledSceneIllustrations().removeImage(args.sessionId, args.turn, args.key, args.versionId) }
      case 'setSceneImageReference': return { illustration: await enabledSceneIllustrations().setReference(args.sessionId, args.turn, args.key, args.versionId, args.consent, args.enabled !== false, args.personId) }
      case 'updateTavernSettings': return { settings: await updateTavernSettings(args && args.patch) }
      case 'getSystemPrompts': return { systemPrompts: presentSystemPrompts(await readTavernSettings()) }
      case 'updateSystemPrompt': {
        const name = str(args && args.name)
        if (!SYSTEM_PROMPT_NAMES.includes(name)) throw new Error('未知系统提示词: ' + name)
        return { systemPrompts: presentSystemPrompts(await updateTavernSettings({ systemPrompt: { name, text: args && args.text } })) }
      }
      case 'resetSystemPrompts': return { systemPrompts: presentSystemPrompts(await updateTavernSettings({ resetSystemPrompts: true })) }
      case 'importSystemPrompts': return { systemPrompts: presentSystemPrompts(await updateTavernSettings({ systemPrompts: importSystemPromptDocument(args && args.payload) })) }
      case 'exportSystemPrompts': {
        const current = presentSystemPrompts(await readTavernSettings())
        const document = { spec: current.spec, version: current.version, prompts: Object.fromEntries(current.prompts.map(function (item) { return [item.name, item.text] })) }
        return { name: 'dsh-tavern-system-prompts.json', text: JSON.stringify(document, null, 2) + '\n' }
      }
      case 'getTavernBackgroundRetirementNotices': return getTavernBackgroundRetirementNotices(args)
      case 'listSessions': {
        const settings = await readTavernSettings()
        return { sessions: await listTavernSessions(), capabilities: { compatibilityMode: true, trustedCardMode: settings.trustedCardMode } }
      }
      case 'renameConversation': {
        const chat=await chatForSession(args?.sessionId)
        if(!chat)throw Error('当前会话没有绑定 Tavern 对话')
        const title=str(args?.title)
        const saved=await updateChat(chat.id,current=>({...current,title}),{source:'conversation.rename'})
        // A best-effort summary refresh in updateChat is insufficient here.
        await conversationRegistry.sync(saved)
        sessionSignals.publish(args.sessionId,{kind:'tavern-state',version:'rename:'+Date.now()})
        return {title:saved.title}
      }
      case 'markConversationOpened': return await conversationRegistry.touch(args && args.sessionId, Date.now())
      case 'listMobileCardImports': return await mobileCardImport.list()
      case 'importMobileCard': {
        if(args?.scriptScope||args?.scriptId)throw Error('人物卡导入只能从宿主界面操作')
        return { card: await importCard(await mobileCardImport.read(args && args.id),args?.trustResource===true) }
      }
      case 'importCard': {
        if(args?.trustResource && (args.scriptScope||args.scriptId))throw Error('导入授信只能由宿主界面设置')
        return { card: await importCard(args && args.payload,args?.trustResource===true) }
      }
      case 'deleteCard': return await deleteCard(args && args.path)
      case 'prepareDeleteChats': return await deleteChats(args && args.chatIds, true)
      case 'deleteChats': return await deleteChats(args && args.chatIds)
      case 'deleteChat': return await deleteChat(args && args.chatId)
      case 'prepareConversationFork': {
        const plan = await prepareConversationFork(args?.chatId, args?.sessionId, args?.turn)
        return { turn: plan.turn, atSeq: plan.atSeq, sourceRevision: plan.source._storageRevision }
      }
      case 'forkChat': return { fork: await forkChat(args?.chatId, args?.sessionId, args?.targetSessionId, args?.turn, args?.sourceRevision, args?.atSeq) }
      case 'exportGamePackage': {if(args.scriptScope||args.scriptId)throw Error('整局包只能由宿主界面导出');await gameResourceBindings.refresh(args.sessionId);return {document:await gamePackages.export(args.sessionId)}}
      case 'exportGamePackageFile': {if(args.scriptScope||args.scriptId)throw Error('整局包只能由宿主界面导出');await gameResourceBindings.refresh(args.sessionId);return gamePackageTransfer.prepareExport(args.sessionId)}
      case 'previewGamePackage': {if(args.scriptScope||args.scriptId)throw Error('整局包只能由宿主界面导入');return {preview:await gamePackages.preview(args.document)}}
      case 'importGamePackage': {if(args.scriptScope||args.scriptId)throw Error('整局包只能由宿主界面导入');return args.transferId?gamePackageTransfer.importFile(args):gamePackages.import(args)}
      case 'exportConversation': return await exportConversation(args && args.chatId, args && args.sessionId, args && args.title)
      case 'exportTavernLogs': return await exportTavernLogs(args && args.sessionId)
      case 'recordTavernCompatibilityCalls': {
        // Diagnostics only need a valid session link, not the full chat snapshot.
        const sessionId = str(args && args.sessionId), chatId = (await conversationRegistry.links())[sessionId]
        if (!chatId || deletedChatIds.has(chatId)) throw new Error('当前 Session 没有绑定 Tavern 对话')
        await compatibilityDiagnostics.record(sessionId, args && args.runtimeId, args && args.calls)
        return { recorded: true }
      }
      case 'recordMvuRuntimeDiagnostic': {
        // Diagnostics only need a valid session link, not the full chat snapshot.
        const sessionId = str(args && args.sessionId), chatId = (await conversationRegistry.links())[sessionId]
        if (!chatId || deletedChatIds.has(chatId)) throw new Error('当前 Session 没有绑定 Tavern 对话')
        const diagnostic = args && args.diagnostic || {}
        if (diagnostic.kind === 'mvu-load' || diagnostic.kind === 'script-load') {
          const detail = sanitizeMvuLoadDiagnostic(diagnostic)
          if (!detail) return { recorded: false }
          try { await mvuDiagnostics.record(sessionId, { stage: diagnostic.kind, diagnostic: detail }) }
          catch { return { recorded: false } }
          return { recorded: true }
        }
        await mvuDiagnostics.record(sessionId, { stage: 'script-runtime', diagnostic: { level: diagnostic.level === 'error' ? 'error' : 'warn', scriptId: str(diagnostic.scriptId).slice(0, 200), message: redactMvuLoadError(diagnostic.message, 4000), ...(sanitizeModuleFailure(diagnostic.moduleFailure) ? { moduleFailure: sanitizeModuleFailure(diagnostic.moduleFailure) } : {}) } })
        return { recorded: true }
      }
      case 'getPlayChatDebugTarget': {
        const sourceChat = await chatForSession(args && args.sessionId)
        if (sourceChat === undefined || ((sourceChat.mode || 'story') !== 'story' && (sourceChat.mode || 'story') !== 'script')) throw new Error('当前对话不是游玩对话')
        const card = await readChatCard(sourceChat)
        return { card: { path: sourceChat.cardPath, name: card.name }, chatId: sourceChat.id }
      }
      case 'attachPlayChatDebug': return { reference: await attachPlayChatDebug(args && args.targetSessionId, args && args.sourceSessionId, args && args.turn) }
      case 'captureDisplayRuntime': return await captureDisplayRuntime(args && args.sessionId, args && args.turn, args && args.partIndex, args && args.runtime)
	      case 'updateTavernHelperPrompts': return await tavernScriptHostAdapter.updatePrompts(args && args.sessionId, args && args.operation, args && args.expectedLifecycleRevision, args && args.eventId)
      case 'setTavernMvuActivity': {
        if(args?.scriptScope !== 'frame') throw new Error('MVU 运行状态来源无效');
        const chat = await assertHelperOwner(args.sessionId,args.scriptId,args.expectedLifecycleRevision);
        if (!await isSelectedMvuCore(chat,args.scriptId)) throw new Error('MVU 运行状态来源无效');
        return tavernScriptDispatch.setMvuActivity(chat,args.runtimeId,args.value);
      }
	      case 'updateTavernHelperVariables': {
        if (isOfficialMvuActivityWrite(args || {}, true)) {
          const chat = await assertHelperOwner(args.sessionId,args.scriptId,args.expectedLifecycleRevision)
          if (await isSelectedMvuCore(chat,args.scriptId)) return tavernScriptDispatch.setMvuActivity(chat,args.runtimeId,args.variables.extra_analysis)
        }
        return await tavernScriptHostAdapter.updateVariables(args && args.sessionId, args && args.option, args && args.variables, args && args.expectedLifecycleRevision, args && args.eventId, args && args.expectedVariables, args && args.mutationMode)
      }
	      case 'updateTavernHelperMessages': return await tavernScriptHostAdapter.updateMessages(args && args.sessionId, args && args.messages, args && args.expectedLifecycleRevision, args && args.eventId)
	      case 'mutateTavernHelperHistory': return await tavernScriptHostAdapter.mutateHistory(args?.sessionId,args?.operation,args?.expectedLifecycleRevision,args?.eventId)
      case 'createTavernHelperMessages': return await tavernScriptHostAdapter.createMessages(args && args.sessionId, args && args.messages, args && args.option, args && args.expectedLifecycleRevision, args && args.eventId)
      case 'getFullPromptTemplateRecovery': return fullTemplateCommitter.inspect(args.sessionId)
      case 'getTemplateEngineStatus': return {...await templateEngineStatus(args.sessionId),runtime:fullPromptTemplates.inspect()}
      case 'setTemplateEngineMode': {
        if(args.scriptScope||args.scriptId)throw new Error('本局模板模式请从宿主设置界面修改')
        if(!['auto','lightweight','full'].includes(args.mode))throw new Error('模板模式无效')
        const chat=await chatForSession(args.sessionId);if(!chat)throw new Error('当前游玩不存在')
        if((await sessionActivity(args.sessionId))?.busy)throw new Error('请等待当前生成完成后切换模板模式')
        const saved=await updateChat(chat.id,current=>{current.promptTemplateEngine=args.mode;return current},{source:'template-engine.mode'})
        return templateEngineStatus(saved)
      }
      case 'resolveFullPromptTemplateRecovery': return fullTemplateCommitter.resolve(args.sessionId,args)
      case 'runFullPromptTemplate': {
        await templateEngineStatus(args.sessionId,{api:true})
        return fullPromptTemplates.execute(args.sessionId, args.operation,{networkOwner:args.scriptScope==='frame'?args.scriptId:undefined})
      }
      case 'getTavernHelperEventStatus': return helperEvents.inspect(args.sessionId)
      case 'resolveTavernHelperEvent': return helperEvents.resolve(args.sessionId,args)
      case 'getTavernBackgroundScriptRuntime': return args.diagnostics?backgroundScripts.diagnose():backgroundScripts.inspect()
      case 'getFullPromptTemplateRuntime': {
        await templateEngineStatus(args.sessionId,{api:true})
        return { ...(await fullPromptTemplates.execute(args.sessionId, { kind: 'features' })), status: fullPromptTemplates.inspect() }
      }
      case 'loadFullPromptTemplateWorldInfo': return tavernScriptHostAdapter.loadFullPromptTemplateWorldInfo(args.sessionId, args.name)
      case 'saveFullPromptTemplateWorldInfo': return tavernScriptHostAdapter.saveFullPromptTemplateWorldInfo(args.sessionId, args.name, args.worldInfo, args.expectedWorldInfo)
      case 'getFullPromptTemplateState': return await tavernScriptHostAdapter.readFullPromptTemplateState(args && args.sessionId)
      case 'saveFullPromptTemplateGlobals': return await tavernScriptHostAdapter.saveFullPromptTemplateGlobals(args && args.sessionId, args && args.variables, args && args.expectedVariables)
      case 'saveFullPromptTemplateSettings': return await tavernScriptHostAdapter.saveFullPromptTemplateSettings(args && args.sessionId, args && args.settings, args && args.expectedSettings)
      case 'saveFullPromptTemplateState': return await tavernScriptHostAdapter.saveFullPromptTemplateState(args && args.sessionId, args && args.state)
      case 'saveTavernChatData': return await tavernScriptHostAdapter.saveChatData(args && args.sessionId, args && args.request, args?.eventId)
      case 'saveTavernExtensionSettings': return await tavernScriptHostAdapter.saveExtensionSettings(args && args.sessionId, args && args.settings, args && args.expectedSettings, args && args.scriptId, args && args.expectedLifecycleRevision, args && args.settingsPatches)
      case 'getPrivateWorldbookChanges': {
        if(args?.scriptScope||args?.scriptId)throw Error('请从世界书面板查看本局改动')
        return privateWorldbookPublication.inspect(args.sessionId,args.key)
      }
      case 'publishPrivateWorldbookChanges': {
        if(args?.scriptScope||args?.scriptId)throw Error('请从世界书面板人工选择要推送的条目')
        return privateWorldbookPublication.publish(args.sessionId,args)
      }
      case 'loadTavernWorldInfo': return await tavernScriptHostAdapter.loadWorldInfo(args && args.sessionId, args && args.name)
      case 'saveTavernWorldInfo': return await tavernScriptHostAdapter.saveWorldInfo(args && args.sessionId, args && args.name, args && args.worldInfo, args && args.expectedWorldInfo, false, args?.eventId)
      case 'getTavernAudio': {const chat=await chatForSessionReadonly(args.sessionId);if(!chat)throw new Error('当前会话不存在');return {helperAudio:await helperAudio.snapshot(chat)}}
      case 'changeTavernAudio': {const chat=await chatForSession(args.sessionId);if(!chat)throw new Error('当前会话不存在');return helperAudio.mutate(args.sessionId,args.command,null,Number(chat.tavernHelperLifecycleRevision)||0)}
      case 'tavernHelperAudio': return helperAudio.mutate(args.sessionId,args.command,args.scriptId,args.expectedLifecycleRevision)
      case 'tavernHelperWorldbookLibrary': return helperWorldbooks.mutate(args.sessionId,args.operation,args.scriptId,args.expectedLifecycleRevision)
      case 'getTavernHelperWorldbook': return await tavernScriptHostAdapter.getWorldbook(args && args.sessionId, args && args.name)
      case 'replaceTavernHelperWorldbook': return await tavernScriptHostAdapter.replaceWorldbook(args && args.sessionId, args && args.name, args && args.entries, args && args.expectedEntries, args?.eventId)
      case 'takeTavernScriptRuntime': {
        const chat=await chatForSession(args.sessionId);if(!chat||!await hasTavernScriptRuntime(chat,await effectiveHelperScripts(chat)))throw new Error('当前聊天没有启用脚本')
        if(helperGenerations.busy(undefined,args.sessionId)||extensionRuntime.status().busy||tavernScriptDispatch.status(args.sessionId).busy)throw new Error('脚本或数据库任务正在执行，请完成后再切换窗口')
        // An explicit takeover is the user's decision: a retained background realm
        // is not retried first, and is released once the page owns the game.
        await backgroundScripts.yieldToFrontend(args.sessionId,args.runtimeId,{takeover:true})
        const taken=tavernScriptDispatch.takeOver(args.sessionId,args.runtimeId)
        await backgroundScripts.yieldToFrontend(args.sessionId,args.runtimeId,{takeover:true})
        return taken
      }
	  case 'claimTavernScriptWork': {await backgroundScripts.yieldToFrontend(args?.sessionId,args?.runtimeId);const result=tavernScriptHostAdapter.claimWork(args && args.sessionId,args && args.runtimeId,args && args.ready,args && args.initializationError,args?.leaseProtocol,args?.mvuValidation);const unloadAccess=result.active?frameUnloads.issue(args.sessionId,args.runtimeId):null;return unloadAccess?{...result,unloadAccess}:result}
	  case 'startTavernScriptWork': return String(args?.eventId||'').startsWith('display-render:')?tavernScriptHostAdapter.startDisplayedMessageWork(args):tavernScriptHostAdapter.startWork(args && args.sessionId, args && args.eventId, args && args.leaseToken, args && args.runtimeId)
      case 'enqueueTavernDisplayedMessage': {
        if(args?.scriptScope||args?.scriptId)throw new Error('正文呈现只能由宿主界面登记');
        return tavernScriptHostAdapter.enqueueDisplayedMessage(args);
      }
      case 'cancelTavernDisplayedMessage': {
        if(args?.scriptScope||args?.scriptId)throw new Error('正文呈现只能由宿主界面取消');
        return tavernScriptDispatch.cancelDisplayedMessage(args?.sessionId,args?.eventId,args?.runtimeId);
      }
	  case 'heartbeatTavernScriptRuntime': {await backgroundScripts.yieldToFrontend(args?.sessionId,args?.runtimeId);const result=tavernScriptHostAdapter.heartbeatRuntime(args && args.sessionId,args && args.runtimeId,args && args.ready,args && args.initializationError,args?.leaseProtocol,args?.mvuValidation);const unloadAccess=result.active?frameUnloads.issue(args.sessionId,args.runtimeId):null;return unloadAccess?{...result,unloadAccess}:result}
	  case 'completeTavernHelperEvent': {
        const completed=tavernScriptHostAdapter.completeEvent(args && args.sessionId, args && args.eventId, args && args.args, args && args.runtimeId, args && args.leaseToken, args && args.error, sanitizeRuntimeDiagnostics(args && args.diagnostics))
        if(completed&&!args?.error)await helperGenerations.completeEvent(args.sessionId,args.eventId,args.runtimeId)
        return {completed}
      }
      case 'reserveTavernHelperRuntime': {const result=args?.kind==='unloading'&&!args?.retry&&!args?.error?tavernScriptDispatch.reserveUnload(args.sessionId,args.runtimeId,{unloadId:args.unloadId,hostIdle:args.hostIdle,scope:originalSpUnloadScope(args.sessionId),durationMs:args.durationMs}):tavernScriptDispatch.reserveDrain(args?.sessionId,args?.runtimeId,args?.error,args?.durationMs,args?.retry,args?.recoveryToken);if(args?.error)await mvuDiagnostics.record(args.sessionId,{stage:'sp-drain-failed',error:String(args.error).slice(0,2000)});return result}
      case 'quarantineTavernHelperRuntime': return tavernScriptDispatch.quarantine(args?.sessionId,args?.runtimeId,args?.error)
      case 'retryTavernBackgroundScriptDrain': return backgroundScripts.retryDrain(args?.sessionId)
	  case 'releaseTavernHelperRuntime': return { released: tavernScriptHostAdapter.releaseRuntime(args && args.sessionId, args && args.runtimeId) }
      case 'previewChatImport': return await chatHistoryImporter.preview(args || {})
      case 'importChatHistory': return await chatHistoryImporter.import(args || {})
      case 'rescueChatHistory': return await chatHistoryImporter.rescue(args || {})
      case 'startChat': {
        try {
          return { view: await startChat(args && args.path, args && args.sessionId, args && args.mode, args && args.openingId, args && args.userName, args && args.requestMode, args && args.preparationId, args && args.cardTask, args && args.foregroundModel) }
        } catch (error) {
          console.error('dsh-tavern: 创建对话失败', {
            cardPath: str(args && args.path),
            sessionId: str(args && args.sessionId),
            mode: str(args && args.mode),
            openingId: str(args && args.openingId),
            error: str(error && error.message || error)
          })
          throw error
        }
      }
      case 'getBackgroundSuppressedTurns': {
        const id = str(args && args.sessionId)
        if (!id.startsWith('background-')) return { turns: [] }
        const evidence = sessionDebugEvidence(id)
        if (evidence.loaded) return { turns: backgroundSuppressedTurns(evidence.events) }
        const handle = await agentRegistry.resume({ resumeSessionId: id })
        try { return { turns: backgroundSuppressedTurns(sessionEvents(handle.agent.session)) } }
        finally { await handle.dispose() }
      }
      case 'applyUpdatedCard': {
        const sessionId = str(args && args.sessionId)
        const chat = await chatForSession(sessionId)
        if (!chat || !['story', 'script'].includes(chat.mode || 'story') || chat.requestMode === 'sillytavern') throw new Error('仅支持当前游玩会话')
        if ((await sessionActivity(sessionId))?.busy || agentRegistry.get(sessionId)?.phase?.kind === 'running') throw new Error('请等待当前生成和后台任务完成后再应用人物卡')
        if(chat.regenInProgress||chat.pendingRegeneration)throw new Error('上一次正文重新生成尚未完成：请先恢复历史操作，再应用人物卡')
        const card = await readChatCard(chat)
        if (typeof args.digest !== 'string' || !args.digest) throw new Error('请刷新后确认人物卡和世界书更新')
        const patch = {...await playCardSnapshots.replacement(chat, card, args.digest),...await scriptLibrary.cardReplacement(chat)}
        const saved = await updateChat(chat.id, current => {
          if (Number(current.cardContextRevision || 0) !== Number(chat.cardContextRevision || 0) || Number(current.tavernHelperLifecycleRevision || 0) !== Number(chat.tavernHelperLifecycleRevision || 0)) throw new Error('本局状态已变化，请刷新后重试')
          if (backgroundTasks.activity(current).busy || current.regenInProgress || agentRegistry.get(sessionId)?.phase?.kind === 'running') throw new Error('请等待当前生成和后台任务完成')
          return Object.assign(current, patch)
        }, { source: 'card-context.apply-update' })
        return { view: await view(saved, card) }
      }
      case 'getSession': {
        const view=await sessionView(args && args.sessionId)
        return sessionViewTransport.respond(args.sessionId,view,args)
      }
      case 'sendPhoneMessage': return { phoneChat: await phoneChat.send(args || {}) }
      case 'runCompaction': {
        const id = str(args && args.sessionId), chat = await chatForSession(id)
        if (chat && ['story', 'script'].includes(chat.mode)) return { result: await autoCompaction.run(id, { manual: true, signal: compactionAbort.signal }) }
        const result = await withCompactionSession(id, async agent => (await agentCompaction(agent)).compactNow(agent, compactionAbort.signal))
        return { result: { status: 'completed', foreground: { status: 'succeeded', message: result ? '压缩完成' : '没有可压缩的历史' }, background: { status: 'skipped' } } }
      }
      case 'compactionStatus': return { state: await sessionReadQueries.value(args && args.sessionId,'/contextCompaction') || null }
      case 'getTavernSessionIdentity': return {identity:await sessionReadQueries.fields(args?.sessionId,['/mode','/cardName'])}
      case 'getTavernMessageWindow': return {window:await sessionReadQueries.window(args?.sessionId,{before:args?.before,cursor:args?.cursor,limit:args?.limit,pinnedRevision:args?.pinnedRevision,snapshotId:args?.snapshotId})}
      case 'getTavernMessageSlice': return {slice:await sessionReadQueries.slice(args?.sessionId,{indices:args?.indices,pinnedRevision:args?.pinnedRevision,snapshotId:args?.snapshotId})}
      case 'prepareCompaction': return { plan: await tavernCompaction.prepare(args && args.sessionId) }
      case 'compactBackground': return { result: await compactBackground(args && args.sessionId, args && args.operationId) }
      case 'completeCompaction': return { result: await tavernCompaction.complete(args && args.sessionId, args) }
      case 'syncSession': return { sync: await candidateTasks.sync(args && args.sessionId, { requestId: args && args.requestId, kind: args && args.kind }) }
      case 'submitTask': {
        if (str(args && args.kind) !== 'candidate') throw new Error('暂不支持的持久任务类型: ' + str(args && args.kind))
        return { sync: await candidateTasks.submit(args) }
      }
      case 'getSessionActivity': {
        const agent = agentRegistry.get(str(args && args.sessionId))
        return { activity: await sessionActivity(args && args.sessionId), runtimeGeneration, liveSession: Boolean(agent && agent.session) }
      }
      case 'getBackgroundOperation': return { operation: await sessionOperation(args && args.sessionId, args && args.operationId) }
      case 'getScriptVariableMigration': {if(args.scriptScope||args.scriptId)throw Error('变量归属清单只能由宿主界面查看');return scriptVariablePolicy.inspect(args.sessionId)}
      case 'getResourceVersionPanel':
      case 'previewResourceVersion':
      case 'applyResourceVersion':
      case 'discardResourceVersionPreview':
      case 'restoreResourceVersion': {
        if(args.scriptScope||args.scriptId)throw Error('本局资源版本只能由宿主界面操作')
        if(method==='getResourceVersionPanel')return resourceVersionPanel.get(args.sessionId)
        if(method==='previewResourceVersion')return resourceVersionPanel.preview(args.sessionId,args.key)
        if(method==='discardResourceVersionPreview')return resourceVersionPanel.discard(args.sessionId,args.token)
        const result=method==='applyResourceVersion'?await resourceVersionPanel.apply(args.sessionId,args):await resourceVersionPanel.restore(args.sessionId,args)
        sessionSignals.publish(args.sessionId,{kind:'tavern-state',version:'resource-versions:'+Date.now()});return result
      }
      case 'decideScriptVariableMigration': {if(args.scriptScope||args.scriptId)throw Error('变量迁移只能由玩家选择');const result=await scriptVariablePolicy.decide(args.sessionId,args.selections,args.expectedRevision);sessionSignals.publish(args.sessionId,{kind:'tavern-state',version:'variable-policy:'+result.revision});return result}
      case 'setGameResourceMode': {if(args.scriptScope||args.scriptId)throw Error('资源跟随设置只能由宿主界面操作');const chat=await gameResourceBindings.setMode(args.sessionId,args.selection,args.expectedRevision);return {modes:chat.resourceBindings,configRevision:chat.playConfigRevision}}
      case 'getPlayManagement': return playManagement.read(args.sessionId)
      case 'editTavernPersona': return playManagement.editPersona(args.operation,args.expectedRevision)
      case 'getWritingSkills': return {skills:await writingSkillsFor(await chatForSessionReadonly(args.sessionId))}
      case 'browseScript': return scriptNavigation.browse(args.sessionId,args.position)
      case 'pointScript': return scriptNavigation.point(args.sessionId,args)
      case 'setScriptChunkSize': return scriptNavigation.setChunkSize(args.sessionId,args)
      case 'applyPlayConfiguration': {const result=await playManagement.apply(args.sessionId,args.operation,args.expectedRevision);invalidateSkills();return result}
      case 'setPlayerName': return { playerName: await setPlayerName(args && args.sessionId, args && args.userName) }
      case 'setRequestMode': return { requestMode: await setRequestMode(args && args.sessionId, args && args.requestMode) }
      case 'ensureOpening': return { view: await ensureNativeOpening(args && args.sessionId) }
      case 'getChoices': return { candidates: await candidateGenerator.find({ sessionId: args && args.sessionId, messageId: args && args.messageId }) }
      case 'startChoices': return await candidateTasks.startLegacy(args)
      case 'exportCard': {
        const cardPath = args && args.path
        const workspace = await readCardWorkspace(cardPath)
        if (workspace === undefined) throw new Error('人物卡不存在: ' + (args && args.path))
        const characterBook = await worldBooks.characterBookForCard(cardPath)
        return { document: cardPreparation.present({ card: workspace, as: 'sillytavern-v3', characterBook }) }
      }
      case 'editLedger': { await ledgerEditor(args || {}); return { view: await sessionView(args.sessionId) } }
      case 'addGuide': return { guides: await addGuide(args && args.sessionId, args && args.text) }
      case 'deleteGuide': return { guides: await deleteGuide(args && args.sessionId, args && args.id) }
      case 'removeCharacterDesign': return await manualCharacterDesign.remove({ sessionId: args?.sessionId, name: args?.name, expectedStamp: args?.expectedStamp })
      case 'designCharacter': return await manualCharacterDesign.start({ sessionId: args && args.sessionId, guidance: args && args.guidance })
      case 'listGuideLibrary': return { items: await guideLibrary.list() }
      case 'saveGuideLibrary': return { item: await saveGuidePlan(args && args.sessionId, args && args.name) }
      case 'loadGuideLibrary': return { guides: await loadGuidePlan(args && args.sessionId, args && args.id) }
      case 'updateGuideLibrary': return { item: await guideLibrary.update(args || {}) }
      case 'deleteGuideLibrary': { await guideLibrary.remove(args || {}); return { ok: true } }
      case 'getInputEdit': return {edit:await inputEditor.read(args?.sessionId,args?.turn)}
      case 'saveInputEdit': return {view:await inputEditor.save(args?.sessionId,args)}
      case 'getBodyEdit': return { edit: await bodyEditor.read(args && args.sessionId) }
      case 'saveBodyEdit': return { view: await bodyEditor.save(args && args.sessionId, args) }
      case 'regenBody': return { view: await regenBody(args && args.chatId, args && args.guidance, args && args.sessionId, args?.expectedTurn) }
      case 'getRollbackPreview': return { preview: await rollbackPreview(args?.sessionId, args?.chatId) }
      case 'rollbackTurn': return { view: await rollbackTurn(args && args.sessionId, args && args.chatId, args?.expectedTurn, args?.expectedCharacterDesignStamp) }
      case 'getBackgroundProgress': return { progress: backgroundAgentRunner.progress(args && args.sessionId) }
      case 'stopBackground': return await stopBackground(args && args.sessionId, args && args.operationId)
      case 'retrySettlement': return { view: await retrySettlement(args && args.sessionId, args && args.turn, args?.guidance) }
      case 'retryMvuSettlement': return { view: await retrySettlement(args && args.sessionId, args && args.turn, args?.guidance) }
      case 'setTavernMvuSettlementPaused':
        if (args?.scriptScope || args?.scriptId) throw new Error('MVU 变量结算开关只能从宿主界面操作')
        return { view: await setMvuSettlementPaused(args && args.sessionId, args?.paused === true) }
      default: throw new Error('未知方法: ' + method)
    }
  }

  async function coordinationVersion(sessionId) {
    const normalizedSessionId = str(sessionId)
    const links = await readSessionMap()
    const chatId = str(links && links[normalizedSessionId])
    const chatVersion = chatId === '' ? '' : await chatPersistence.version(chatId)
    const projectionVersion = await profileData.version('card-projection-revisions.json')
    return [runtimeGeneration, chatId, chatVersion, projectionVersion].join(':')
  }

  coordinationEvents = createCoordinationEventPublisher({
    readVersion: async function (sessionId) { return await coordinationVersion(sessionId) },
    load: async function (sessionId) { return await candidateTasks.sync(sessionId, { kind: 'candidate' }) },
    publishSignal: function (sessionId, signal) { sessionSignals.publish(sessionId, signal) },
    fallbackIntervalMs: 5000,
    onError(error) {
      console.warn('dsh-tavern: 协调文件读取失败，将继续重试:', str(error && error.message || error))
      void mvuDiagnostics.record('coordination', {stage:'coordination-read',diagnostic:{level:'warning',message:redactMvuLoadError(error)}}).catch(() => {})
    }
  })

  ctx.provide('tavernSessionSignals',Object.freeze(scopedSessionSignals({transport:sessionSignals,watch:id=>coordinationEvents.watch(id),listOwned:async ids=>{
    const links=await readSessionMap(),owned=new Set(Object.keys(links||{}))
    if(ids.some(id=>!owned.has(id)))for(const row of (await readIndex()).chats||[]){const chat=await readChatReadonly(row.id);for(const participant of Object.values(chat?.timeline?.participants||{}))if(participant.sessionId)owned.add(participant.sessionId)}
    return [...owned]
  }})))

  const webServer = ctx.get('webServer')
  if (webServer !== undefined) {
    const requestGate = createTavernRequestGate({ rpcBytes:capacityLimits.process.rpcBytes,frameResources,frameUnloads, address: () => webServer.server.address(), requestRejection: req => {
      const connection = ctx.get('connection')
      if (typeof connection?.requestRejection !== 'function') return 503
      return connection.requestRejection(req)
    } })
    ctx.effect(() => observeHttpRequests(webServer.server, snapshot => performanceDiagnostics.http(snapshot)))
    // Fixed SillyTavern compatibility version for card-script feature probes.
    ctx.effect(() => {
      return webServer.register({
        kind: 'prefix',
        path: '/version',
        handler: async (req, res) => {
          const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
          if (pathname !== '/version') { res.writeHead(404); res.end('not found'); return }
          if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return }
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
          res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ pkgVersion: '1.12.14' }))
        }
      })
    })
    ctx.effect(() => webServer.register({
      kind: 'prefix',
      path: '/api/dsh-tavern',
      handler: async (req, res) => {
        let access
        try { access = requestGate.check(req) } catch (error) {
          res.writeHead(error.status || 400, { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', Connection: 'close' })
          res.end(JSON.stringify({ ok: false, error: error.message }))
          return
        }
        const pathname = access.pathname
        if(access.frameUnload){
          try{await requestGate.readBody(req,access);const vote=frameUnloads.vote(req);res.writeHead(vote.invalid?409:204,{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end();}
          catch(error){res.writeHead(error.status||400,{'Cache-Control':'no-store'});res.end();}
          return;
        }
        const cachedAssetMatch = /^\/api\/dsh-tavern\/remote-assets\/([0-9a-f]{64})(?:\/[^/]*)?$/i.exec(pathname)
        const readsStaticAsset = req.method === 'GET' && pathname === '/api/dsh-tavern/static-assets'
        const readsFullTemplate = req.method === 'GET' && pathname.startsWith(FULL_PROMPT_TEMPLATE_ASSET_PREFIX)
        const readsOfficialMvu = req.method === 'GET' && pathname === OFFICIAL_MVU_VERSION.assetUrl
        const readsRuntimeAsset = req.method === 'GET' && pathname.startsWith(TAVERN_RUNTIME_ASSET_PREFIX)
        const readsClientAsset = req.method === 'GET' && pathname.startsWith(TAVERN_CLIENT_ASSET_PREFIX)
        const readsCachedAsset = req.method === 'GET' && cachedAssetMatch
        if (req.method === 'GET' && pathname === '/api/dsh-tavern/runtime-generation') {
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store, max-age=0'
          })
          res.end(JSON.stringify({ ok: true, runtimeGeneration }))
          return
        }
        try {
          if (pathname === '/api/dsh-tavern/game-package-files' || pathname.startsWith('/api/dsh-tavern/game-package-files/')) {
            await maintenanceGate.read(()=>gamePackageTransfer.handle(req,res,pathname));return
          }
          if (req.method === 'GET' && pathname.startsWith('/api/dsh-tavern/frame-assets/')) {
            const asset=await frameResources.read(req)
            res.writeHead(200,{'Content-Type':asset.mediaType,'Content-Length':asset.body.length,'Cache-Control':'private, no-store','Access-Control-Allow-Origin':'*','Cross-Origin-Resource-Policy':'cross-origin',...requestGate.assetHeaders(asset.mediaType)})
            res.end(asset.body);return
          }
          if (readsFullTemplate) {
            const asset = await readFullPromptTemplateAsset(pathname)
            if (!asset) { res.writeHead(404, { 'X-Content-Type-Options': 'nosniff' }); res.end('not found'); return }
            res.writeHead(200, { 'Content-Type': asset.mediaType, 'Content-Length': asset.body.length,
              'ETag': asset.etag, 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*',
              'Cross-Origin-Resource-Policy': 'cross-origin', 'X-Content-Type-Options': 'nosniff' })
            res.end(asset.body)
            return
          }
          if (readsClientAsset) {
            const asset = await readTavernClientAsset(pathname)
            if (asset === undefined) {
              res.writeHead(404, { 'X-Content-Type-Options': 'nosniff' })
              res.end('not found')
              return
            }
            res.writeHead(200, {
              'Content-Type': asset.mediaType,
              'Content-Length': asset.body.length,
              'Cache-Control': 'no-cache',
              'Access-Control-Allow-Origin': '*',
              'Cross-Origin-Resource-Policy': 'cross-origin',
              'X-Content-Type-Options': 'nosniff'
            })
            res.end(asset.body)
            return
          }
          if (readsRuntimeAsset) {
            const asset = await readTavernRuntimeAsset(pathname)
            res.writeHead(200, {
              'Content-Type': asset.mediaType,
              'Content-Length': asset.body.length,
              'Cache-Control': 'public, max-age=31536000, immutable',
              'Access-Control-Allow-Origin': '*',
              'Cross-Origin-Resource-Policy': 'cross-origin',
              'X-Content-Type-Options': 'nosniff'
            })
            res.end(asset.body)
            return
          }
          const readiness = await runtimeReadiness
          if (!readiness.ok) throw readiness.error
          if(req.method==='GET'&&pathname.startsWith('/api/dsh-tavern/script-images/')){
            const image=await scriptImages.read('/user/images/unified-statusbar/'+pathname.slice('/api/dsh-tavern/script-images/'.length));
            if(!image){res.writeHead(404);res.end('not found');return}
            res.writeHead(200,{'Content-Type':image.mediaType,'Content-Length':image.body.length,'Cache-Control':'private, no-cache','X-Content-Type-Options':'nosniff'});res.end(image.body);return;
          }
          if (req.method === 'GET' && pathname === '/api/dsh-tavern/card-image') {
            const query = new URL(req.url, 'http://x').searchParams
            const body = await fileResources.readCardImage(query.get('path'))
            if (body === undefined) {
              res.writeHead(404, { 'X-Content-Type-Options': 'nosniff' })
              res.end('not found')
              return
            }
            res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': body.byteLength, 'Cache-Control': 'private, no-cache', 'X-Content-Type-Options': 'nosniff' })
            res.end(body)
            return
          }
          if (TAVERN_RELEASE_CAPABILITIES.sceneImages && req.method === 'GET' && pathname === '/api/dsh-tavern/scene-image') {
            const query = new URL(req.url, 'http://x').searchParams
            const image = await sceneIllustrations.readImage(query.get('sessionId'), Number(query.get('turn')), query.get('key'), query.get('versionId'))
            res.writeHead(200, { 'Content-Type': image.ref.mediaType, 'Content-Length': image.data.byteLength, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' })
            res.end(image.data)
            return
          }
          if (readsOfficialMvu) {
            const asset = await readOfficialMvuBundle()
            res.writeHead(200, {
              'Content-Type': asset.mediaType,
              'Content-Length': asset.body.length,
              'Cache-Control': 'public, max-age=31536000, immutable',
              'ETag': asset.etag,
              'Access-Control-Allow-Origin': '*',
              'Cross-Origin-Resource-Policy': 'cross-origin',
              'X-Content-Type-Options': 'nosniff',
              'X-DSH-Tavern-MVU-Commit': asset.commit
            })
            res.end(asset.body)
            return
          }
          if (readsCachedAsset) {
            const asset = await tavernRemoteAssets.readCached(cachedAssetMatch[1])
            if (!asset) {
              res.writeHead(404, { 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff' })
              res.end('not found')
              return
            }
            const body = projectCachedResourceBody({ url: asset.url, mediaType: asset.mediaType, body: Buffer.from(asset.content, 'utf8') })
            res.writeHead(200, {
              'Content-Type': cachedResourceMediaType(asset) + '; charset=utf-8',
              ...requestGate.assetHeaders(cachedResourceMediaType(asset)),
              'Content-Length': body.length,
              'Cache-Control': 'public, max-age=31536000, immutable',
              'Access-Control-Allow-Origin': '*',
              'Cross-Origin-Resource-Policy': 'cross-origin',
              'X-Content-Type-Options': 'nosniff'
            })
            res.end(body)
            return
          }
          if (readsStaticAsset) {
            const target = new URL(req.url ?? '/', 'http://x')
            const asset = await tavernStaticResources.get(target.searchParams.get('url'),{trustedResource:true})
            const body = projectCachedResourceBody(asset,{scriptId:target.searchParams.get('scriptId')||''})
            res.writeHead(200, {
              'Content-Type': cachedResourceMediaType(asset),
              ...requestGate.assetHeaders(cachedResourceMediaType(asset)),
              'Content-Length': body.length,
              'Cache-Control': 'public, max-age=31536000, immutable',
              'Access-Control-Allow-Origin': '*',
              'Cross-Origin-Resource-Policy': 'cross-origin',
              'X-Content-Type-Options': 'nosniff',
              'X-DSH-Tavern-Cache': asset.cache
            })
            res.end(body)
            return
          }
          const method = pathname.slice('/api/dsh-tavern'.length + 1)
          if (req.method !== 'POST') {
            res.writeHead(405)
            res.end()
            return
          }
          // HTTP chunks may split a UTF-8 code point. Decode only after joining bytes;
          // decoding each chunk corrupts Chinese snapshots and causes false conflicts.
          const body = await requestGate.readBody(req, access)
          let args = {}
          try {
            args = body.trim() === '' ? {} : JSON.parse(body)
            if (args === null || typeof args !== 'object' || Array.isArray(args)) args = {}
          } catch (err) {
            res.writeHead(400)
            res.end('bad json')
            return
          }
          const result = await dispatch(method, args)
          if(method==='getSession'&&args.viewProtocol===3){
            const encoded=await jsonHttpResponse(Object.assign({ok:true},result,{runtimeGeneration}),req.headers['accept-encoding'])
            res.writeHead(200,encoded.headers);res.end(encoded.body);return
          }
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify(Object.assign({ ok: true }, result, { runtimeGeneration })))
        } catch (err) {
          if (res.headersSent) {res.destroy();return}
          if (pathname.startsWith('/api/dsh-tavern/game-package-files')) {
            res.writeHead(err.status||400,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',Connection:'close'})
            res.end(JSON.stringify({ok:false,error:str(err.message||err)}));return
          }
          res.removeHeader?.('Content-Length')
          if(req.method === 'GET' && /\/(?:card-image|scene-image|script-images\/|static-assets|remote-assets\/|frame-assets\/)/.test(pathname)) {
            res.writeHead(err.status === 403 ? 403 : err.status === 404 || err.code === 'ENOENT' ? 404 : 500,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'})
            res.end(JSON.stringify({ok:false,error:str(err.message || err)}));return
          }
          if (err.status === 413) {
            res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8', Connection: 'close' })
            res.end(JSON.stringify({ ok: false, error: err.message }))
            return
          }
          if (readsOfficialMvu || readsFullTemplate || readsRuntimeAsset) {
            res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
              'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff' })
            res.end(JSON.stringify({ ok: false, error: redactMvuLoadError(err && err.message || err) }))
            return
          }
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, error: str(err && err.message || err) }))
        }
      }
    }), 'dsh-tavern: web route')
  }

  function contentText(message) {
    if (message === null || typeof message !== 'object' || !Array.isArray(message.content)) return ''
    return message.content.map(function (block) { return block !== null && typeof block === 'object' && block.type === 'text' ? str(block.text) : '' }).filter(Boolean).join('\n').trim()
  }

  function isTurnInput(message) {
    return isTavernTurnInput(message)
  }

  function activeTurnOf(exec) {
    const phase = exec && exec.agent ? exec.agent.phase : null
    return phase && phase.kind === 'running' ? Math.max(0, Number(phase.turn) || 0) : 0
  }

  function requestIdOf(message) {
    if (isTavernTriggerInput(message)) return str(message.id).trim()
    const source = message && message.source
    return source && source.kind === 'user' ? str(source.rpcId).trim() : ''
  }

  function requestIdForMessages(messages) {
    const list = Array.isArray(messages) ? messages : []
    for (let index = list.length - 1; index >= 0; index--) {
      if (isTurnInput(list[index])) return requestIdOf(list[index])
    }
    return ''
  }

  function replaceAssistantReply(session, result, bodyText) {
    if (result === null || result.text === bodyText) return
    const previous = result.event && result.event.data && result.event.data.message
    if (previous === null || typeof previous !== 'object') return
    appendAssistantEvent(session, {
      turn: Number(result.event.data && result.event.data.turn) || 0,
      step: Number(result.event.data && result.event.data.step) || 1,
      message: Object.assign({}, previous, {
        id: randomUUID(),
        content: [{ type: 'text', text: bodyText }]
      })
    }, {
      surfaceOp: { op: 'replace', startSeq: result.index, endSeq: result.index },
      sourceEventSeqs: [result.index]
    })
  }

  async function resolveChatRuntimePreset(chat) {
    if (!chat || groupOfMode(chat.mode) !== 'play') return null
    return chat.resolvedRuntimePreset?.snapshot || effectiveGamePreset(chat)
  }

  function compatibilityWorldBookMatch(entry, source) {
    if (entry.constant === true) return true
    const text = entry.caseSensitive === true ? source : source.toLocaleLowerCase()
    const keys = Array.isArray(entry.primaryKeys) ? entry.primaryKeys : []
    return keys.some(function (value) {
      const key = str(value).trim()
      if (key === '') return false
      const match = /^\/(.*)\/([dgimsuvy]*)$/.exec(key)
      if (match) {
        try { return new RegExp(match[1], match[2].replace(/[gy]/g, '')).test(source) } catch { return false }
      }
      return text.includes(entry.caseSensitive === true ? key : key.toLocaleLowerCase())
    })
  }

  async function compatibilityWorldInfo(chat, card, input, presetDocument = {}) {
    let worldBook = null
    try { worldBook = await worldBooks.bound(chat.cardPath, card, chat) } catch {}
    let entries = Array.isArray(worldBook && worldBook.view && worldBook.view.entries) ? worldBook.view.entries : []
    if (worldBook && await fullTemplateEnabled(chat,{card,worldbook:worldBook,texts:[input]})) entries = restoreTemplateWorldbookEntries((await fullPromptTemplates.execute(chat.sessionId, {kind:'worldbook',entries:projectTemplateWorldbookEntries(worldBook)})).entries)
    const enabled = entries.filter(entry => entry && entry.enabled !== false && str(entry.content).trim() !== '')
    const selection = selectCompatibilityWorldInfo({ chat, entries: enabled, input, settings: { ...presetDocument, ...(presetDocument.world_info || {}) }, book: worldBook?.view?.raw || {},
      countTokens: text => ctx.get('tokenMeter').estimateMessage({role:'system',content:[{type:'text',text}]}) })
    return {
      ...selection,
      entries: enabled.map(function (entry) {
        return {
          id: str(entry.sourceUid || entry.ref),
          name: str(entry.title),
          comment: str(entry.comment),
          content: str(entry.content),
          enabled: entry.enabled !== false,
          book: str(worldBook && worldBook.view && worldBook.view.displayName)
        }
      })
    }
  }

  async function compileCompatibilityTurn(chat, userText, attachments=[]) {
    const snapshot = await resolveChatRuntimePreset(chat)
    const presetPath = str(snapshot && snapshot.presetPath)
    const preset = presetPath === '' ? createCleanCompatibilityPreset() : snapshot.compatibilityPreset
    const presetDocument = presetPath === '' ? {} : snapshot.compatibilityPresetDocument
    if (!preset || preset.valid !== true || preset.recognized !== true || !presetDocument) throw new Error('当前预设不存在或无法读取：' + presetPath)
    const card = await readChatCard(chat)
    const extensions = await readCardExtensions(chat.cardPath)
    const regexScripts = composeTavernRegexScripts(extensions, snapshot?.regexScripts)
    const worldInfo = await compatibilityWorldInfo(chat, card, userText, presetDocument)
    const history = openingCommandHistory(chat.messages)
    const startPrompt = openingCommandPrompt(chat)
    const operation=Object.values(chat.timeline?.operations||{}).findLast(item=>item.kind==='body'&&item.status==='running')
    const randomSeed=operation?.runtimeRandomSeed||operation?.id
    const compiled = compileSillyTavernRequest({
      card,
      preset,
      presetPath,
      presetDocument,
      history: history.map(function (item) { return { role: item.role, text: str(item.text), sourceText: str(item.sourceText), inputAttachments:inputAttachments(item.inputAttachments) } }),
      input: userText,
      inputAttachments:attachments,
      userName: str(chat.macroState && chat.macroState.userName),
      macroState: chat.macroState,
      randomSeed,frontEntryKeys:(snapshot?.front?.entries||[]).map(entry=>entry.entryKey||entry.id),
      worldInfoBefore: worldInfo.before,
      worldInfoAfter: worldInfo.after,
      worldInfoDepth: worldInfo.depth,
      worldInfoExamplesBefore: worldInfo.examplesBefore,
      worldInfoExamplesAfter: worldInfo.examplesAfter,
      resolveMacros: resolveRuntimeMacroText,
      projectPromptText: function (text, context) {
        const projected=applyTavernRegexText(text, regexScripts, {
          placement: context.placement,
          isMarkdown: false,
          isEdit: false,
          depth: context.depth
        })
        if(projected.changed&&projected.text.includes('{{'))projected.text=resolveRuntimeMacroText(projected.text,{charName:card.name,macroState:chat.macroState,random:seededTavernRandom(randomSeed,'compatibility-regex:'+context.placement+':'+context.depth)}).text
        return projected
      }
    })
    if (startPrompt) {
      compiled.messages.push({ role: 'system', content: startPrompt.content, source: { kind: 'tavern-script-prompt', id: startPrompt.id } })
      compiled.openingCommandPrompt = startPrompt
    }
    compiled.trace.worldBookRefs = worldInfo.refs
    compiled.trace.worldBookActivations = worldInfo.activations
    compiled.trace.worldBookBudget = {tokens:worldInfo.tokens,limit:worldInfo.budget,estimated:true}
    compiled.diagnostics.push(...worldInfo.diagnostics)
    compiled.trace.presetPath = presetPath
    compiled.trace.presetTitle = preset.title
    compiled.trace.presetMode = presetPath === '' ? 'builtin-clean' : 'external'
    compiled.trace.regexCount = regexScripts.length
    const helperMacros = applyTavernHelperVariableMacros(compiled.messages, {
      message: lastTavernHelperVariables(chat.messages),
      chat: chat.variables,
      character: extensions && extensions.variables,
      preset: snapshot && snapshot.variables,
      global: chat.macroState && chat.macroState.global
    })
    compiled.messages = helperMacros.messages
    compiled.trace.tavernHelperVariableMacroCount = helperMacros.replacements
    if (await lightTemplateEnabled(chat,{card,texts:compiled.messages.map(message=>message.content)})) {
    const promptTemplates = await promptTemplateRuntime()
    const transcript = history.map(function (item) {
      return { role: item.role === 'user' ? 'user' : 'assistant', content: str(item.sourceText || item.text) }
    })
    const templateContext = {
      charName: str(card.name),
      userName: str(chat.macroState && chat.macroState.userName) || '你',
      runType: 'generate',
      transcript,
      worldBookEntries: worldInfo.entries,
      scopes: {
        global: await readPromptTemplateGlobalVariables(chat),
        initial: chat.promptTemplateInitialVariables,
        local: chat.variables,
        message: lastTavernHelperVariables(chat.messages)
      }
    }
    const initialized = promptTemplates.initializeVariables(worldInfo.entries, templateContext)
    const templated = promptTemplates.renderMessages(compiled.messages, Object.assign({}, templateContext, { scopes: initialized.scopes }))
    compiled.messages = templated.messages
    compiled.promptTemplateState = {
      scopes: templated.scopes,
      persist: initialized.evaluated + templated.evaluated > 0
    }
    compiled.diagnostics.push(...initialized.diagnostics, ...templated.diagnostics)
    compiled.trace.promptTemplateEvaluations = initialized.evaluated + templated.evaluated
    compiled.trace.promptTemplateDiagnostics = initialized.diagnostics.length + templated.diagnostics.length
    } else { compiled.trace.promptTemplateEngine = await fullTemplateEnabled(chat,{card}) ? "full-1.17.9" : "disabled" }
    const sourceMessageCount = compiled.messages.length
    compiled.messages = chat.izumiApiApplied ? compiled.messages : applySillyTavernStrictTools(compiled.messages, {
      charName: str(card.name),
      userName: str(chat.macroState && chat.macroState.userName)
    })
    if (chat.userProfileEnabled === true) {
      const preferenceText = str(chat.userProfileContextSnapshot)
      if (preferenceText !== '') {
        compiled.messages.unshift({
          role: 'system',
          content: preferenceText,
          source: { kind: 'dsh-user-profile', revision: Number(chat.userProfileRevision) || 0 }
        })
        compiled.trace.userProfileRevision = Number(chat.userProfileRevision) || 0
      }
    }
    compiled.trace.postProcessing = chat.izumiApiApplied?chat.izumiApiApplied.postProcessing||'none':'strict_tools'
    compiled.trace.sourceMessageCount = sourceMessageCount
    compiled.trace.finalMessageCount = compiled.messages.length
    return compiled
  }

  // ---------- DSH 回合生命周期 ----------
  const requestCoordinates = new Map()
  const storyCompactionRequests = new WeakSet()
  const fullTemplateRequests = createFullTemplateRequestProcessor(async(sessionId,operation,options)=>{
    if(await fullTemplateEnabled(sessionId,{texts:operation.messages?.map(message=>message.content)||[]}))return fullPromptTemplates.execute(sessionId,operation,options)
    const {chat,input}=templateInputView(await chatForSession(sessionId)),card=await readChatCard(chat),globalBaseline=await readPromptTemplateGlobalVariables(chat)
    const result=renderLightTemplateRequest(await promptTemplateRuntime(),operation.messages,{
      charName:card.name,userName:chat.macroState?.userName||'你',runType:'generate',
      transcript:chat.messages.map(row=>({role:row.role,content:row.sourceText??row.text})),
      scopes:{global:globalBaseline,initial:chat.promptTemplateInitialVariables,local:chat.variables,message:lastTavernHelperVariables(chat.messages)}
    })
    if(result.evaluated){
      options.signal?.throwIfAborted()
      chat.promptTemplateInitialVariables=result.scopes.initial||{};chat.variables=result.scopes.local||{}
      if(chat.messages.length)replaceTavernHelperVariables(chat,{option:{type:'message',message_id:'latest'},variables:result.scopes.message||{}})
      await writeChat(persistTemplateInputView(chat,input),{source:'light-template.request'})
      await writePromptTemplateGlobalVariables(result.scopes.global,globalBaseline)
    }
    return result
  })
  const helperRequests=createFullTemplateRequestProcessor(async(sessionId,operation,{signal}={})=>{
    // An ordinary event (R8 1.5): with no ready script it is skipped and the prompt is used as is.
    const processed=await tavernScriptHostAdapter.dispatchEvent({sessionId,name:'CHAT_COMPLETION_PROMPT_READY',args:[{chat:operation.messages,prompt:operation.messages,dryRun:false},false],signal,work:{general:true}})
    const messages=processed.args?.[0]?.chat||processed.args?.[0]?.prompt;if(!Array.isArray(messages))throw new Error('脚本生成前事件没有返回有效的提示词')
    return {messages}
  })
  const tavernRetryLimiter = createTavernRetryLimiter({
    owns: async function (agent) {
      const sessionId = agent && agent.session ? agent.session.id : ''
      if (sessionId === '') return false
      return backgroundAgentRunner.owns(sessionId) || await chatForSession(sessionId) !== undefined
    }
  })

  function clearRuntimePresetRequestState(agent) {
    const session = agent && agent.session
    if (session === undefined) return 0
    const sessionId = session.id
    requestCoordinates.delete(sessionId)
    fullTemplateRequests.clear(sessionId)
    helperRequests.clear(sessionId)
    foregroundStrategies.clearRequestState(sessionId)
  }

  function compatibilityMessages(compiled) {
    return compiled.messages.map(function (item, index) {
      const label = str(item.source && (item.source.identifier || item.source.kind)) || 'message-' + (index + 1)
      return {
        id: randomUUID(),
        role: item.role,
        content: projectPlayerContent(item.inputAttachments,item.content,{fallback:false}),
        source: {
          kind: 'plugin', plugin: 'dsh-tavern', form: 'sillytavern-compatibility',
          sections: [{ name: 'tavern:sillytavern:' + label, text: item.content }],
          trace: item.source
        }
      }
    })
  }

  const controlledToolNames = new Set(['bash', 'pwsh', ...dshFileToolNames, 'skill', 'web_search', 'tavern_save_skill', ...cordisToolNames, 'tavern_user_profile_read', 'tavern_user_profile_save_draft', 'tavern_user_profile_confirm', 'tavern_convert_to_mvu', 'tavern_design_mvu_appearance', 'tavern_validate_mvu_conversion', 'tavern_read_card', 'tavern_read_card_raw', 'tavern_search_card', 'tavern_replace_card_text', 'tavern_read_play_chat', 'tavern_read_script', 'tavern_recall_history', 'worldbook_search', 'tavern_read_worldbook', 'tavern_update_worldbook', 'tavern_read_preset', 'tavern_update_preset', 'tavern_update_card', 'tavern_restore_card', 'tavern_validate_card', 'tavern_test_response'])
  toolRestrictions = createTavernToolRestrictions(ctx, {
    resolveChat: async sessionId => backgroundAgentRunner.owns(sessionId) ? null : chatForSession(sessionId),
    visibleTools: (sessionId, chat) => turnOrchestrator.visibleTools(sessionId, chat),
    toolPolicy: (_agent, chat) => toolWorkbench.policy(chat),
    controlledToolNames
  })
  const foregroundStrategies = createForegroundOrchestrationStrategies({
    compatibility: {
      writingMessages:async chat=>compatibilityWritingMessages(tavernSkills,chat,await readTavernSettings()),
      beforeTurn: async function (input) {
        await runtimeRecovery?.waitSession(input.sessionId)
        await clearFailedInputsBeforeTurn(input.sessionId)
        await fullTemplateCommitter.flush(input.sessionId)
        assertMvuCoreUsable(await chatForSession(input.sessionId))
        await awaitForegroundPostCommit(input.sessionId)
        await helperEvents.flush(input.sessionId)
        await spDatabase.beforeTurn(input.sessionId)
        await gameResourceBindings.refresh(input.sessionId, {requestBoundary:true})
      },
      beginTurn: input => turnOrchestrator.beginCompatibility(input),
      chatForSession,
      compileTurn: compileCompatibilityTurn,
      persistCompiled: async function (input) {
        const compiled = input.compiled
        await updateChat(input.chat.id, function (current) {
          if (!current || typeof current !== 'object') return current
          const templateInput=templateInputView(current).input
          consumeOpeningCommandPrompt(current, compiled.openingCommandPrompt, input)
          current.macroState = compiled.macroState
          if (compiled.promptTemplateState && compiled.promptTemplateState.persist === true) {
            const scopes = compiled.promptTemplateState.scopes || {}
            current.promptTemplateInitialVariables = scopes.initial && typeof scopes.initial === 'object' ? scopes.initial : {}
            current.variables = scopes.local && typeof scopes.local === 'object' ? scopes.local : {}
            if (Array.isArray(current.messages) && current.messages.length > 0) {
              replaceTavernHelperVariables(current, {
                option: { type: 'message', message_id: 'latest' },
                variables: scopes.message
              })
            }
            rememberTemplateInputScopes(current,templateInput)
          }
          if (!current.compatibilityTraces || typeof current.compatibilityTraces !== 'object') current.compatibilityTraces = {}
          current.compatibilityTraces[String(input.turn)] = Object.assign({ createdAt: Date.now() }, compiled.trace, { diagnostics: compiled.diagnostics })
          return current
        }, { source: 'compatibility.compile' })
        if (compiled.promptTemplateState && compiled.promptTemplateState.persist === true) {
          await writePromptTemplateGlobalVariables(compiled.promptTemplateState.scopes.global)
        }
      },
      projectMessages: compatibilityMessages
    },
    nativePlay: {
      stagedRequests: runtimePresetSnapshots,
      modeFor: async function (sessionId) { return await turnOrchestrator.modeFor(sessionId) },
      requestSkillFilter:async chat=>{const allowed=new Set((await writingSkillsFor(chat)).filter(skill=>skill.enabled).map(skill=>skill.name));return messages=>filterSkillMessages(messages,'story',allowed)},
      filterMessages: async (messages,mode,chat)=>filterSkillMessages(messages,mode,new Set((await writingSkillsFor(chat)).filter(skill=>skill.enabled).map(skill=>skill.name))),
      resolvePreset: resolveChatRuntimePreset,
      prepareTurn: async function (input) { return await foregroundHandoff.prepare(input) },
      appendFrame: function (input) { return foregroundFrameSessionAdapter.append(input) },
      recordFrame: function (sessionId, frame, receipt) {
        requestCoordinates.set(sessionId, Object.assign({}, requestCoordinates.get(sessionId), {
          frame: {
            frameId: frame.frameId,
            branchId: frame.branchId,
            basedOnRevision: frame.basedOnRevision,
            source: frame.source,
            append: receipt
          }
        }))
      },
      visibleTools: async function (sessionId) { return await turnOrchestrator.visibleTools(sessionId) },
      cardSystemPrompt: function () { return runtimePrompt('card-system') },
      workspaceContext: function (cwd, projection) { return resourceWorkspaceContext(cwd, projection, runtimePrompt('card-workspace')) },
      ensureSessionPrefix: async function (input) {
        return await ensureNativeSystemPrefix(input.payload.agent.session, input.chat)
      },
      ensureWritingSkillStatus: async function (input) {
        const session = input.payload.agent.session
        const event = ensureWritingSkillStatus(session, await writingSkillsFor(input.chat))
        if (event) await sessionStore.flush(session)
        return event
      },
      controlledToolNames
    }
  })

  async function recordModelOutputNotice(chat,notice){
    try{await updateChat(chat.id,current=>{
      if(JSON.stringify(current.modelOutputNotice?.notice)===JSON.stringify(notice))return
      current.modelOutputNotice={notice,at:Date.now()};return current
    },{source:'model.output-limit',touchUpdatedAt:false})}catch(error){console.warn('dsh-tavern: 输出长度调整提示未保存',String(error.message||error))}
  }
  ctx.on('agent/request', async function (payload, next) {
    const sessionId = payload.agent && payload.agent.session ? payload.agent.session.id : ''
    if (sessionId !== '') requestCoordinates.set(sessionId, { turn: payload.turn, step: payload.step })
    let config=await next()
    // The host has resolved this request's actual model. Background work must
    // not inherit the parent's preset, Izumi connection, or foreground cap.
    if(backgroundAgentRunner.owns(sessionId))return configuredBackgroundOutput(config,{llm,settings:ctx.get('settings')})
    const chat=sessionId?await chatForSessionReadonly(sessionId):null;
    if(chat&&!backgroundAgentRunner.owns(sessionId))config={...config,...nativePresetSampling(presetSampling(chat.resolvedRuntimePreset?.snapshot||effectiveGamePreset(chat)),config.provider)};
    let route
    if(chat?.izumiApiApplied){const current=await izumiConnection.read(sessionId);route=current.apiUrl;config={...config,...(current.temperature!==''?{temperature:current.temperature}:{}),...(current.maxTokens!==''?{maxTokens:current.maxTokens}:{})}}
    if(chat&&!backgroundAgentRunner.owns(sessionId)){
      const limit=configuredOutputLimit(config,{llm,settings:ctx.get('settings')},route)
      if(limit&&Number.isSafeInteger(config.maxTokens)&&config.maxTokens>limit.maxTokens){await recordModelOutputNotice(chat,{parameter:'max_tokens',requested:config.maxTokens,applied:limit.maxTokens,source:limit.source,model:config.model,provider:config.provider});config={...config,maxTokens:limit.maxTokens}}
    }
    return config
  })

  ctx.on('agent/request-error', tavernRetryLimiter.handle, { prepend: true })

  const foregroundModels = createForegroundModelSelection({
    chats:{forSession:chatForSessionReadonly,update:(id,fn)=>updateChat(id,fn,{source:'foreground-model.selection',touchUpdatedAt:false})},
    settings:()=>tavernSettingsDocument,resolve:model=>llm.resolveCallConfig(model),
    select:(agent,model)=>ctx.get('sessionController').agents.selectForNextRequest(agent,model),
    serialize:(agent,operation)=>ctx.get('sessionController').agents.serializeImageAdmission(agent,operation),
    flush:session=>sessionStore.flush(session),
    report:({sessionId,stage,error})=>console.error('dsh-tavern: '+stage+'失败',sessionId,error)
  })
  ctx.on('session/event',(session,event)=>{if(!backgroundAgentRunner.owns(session.id))foregroundModels.observe(session,event)})
  ctx.on('agent/disposed',({agent})=>foregroundModels.forget(agent.session.id))
  ctx.on('system-prompt/assemble',async (_assembly,context,next)=>{
    if(context?.agent&&!backgroundAgentRunner.owns(context.agent.session.id))await foregroundModels.synchronize(context.agent)
    return next()
  },{prepend:true})

  ctx.on('agent/pre-step', async function (payload, next) {
    const sessionId = payload.agent && payload.agent.session ? payload.agent.session.id : ''
    if (backgroundAgentRunner.owns(sessionId)) return next()
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const chat = await chatForSession(sessionId)
    if (chat) performanceDiagnostics.turnStart({chatId:chat.id,sessionId,turn:payload.turn})
    if (chat?.nativeHistoryEdit)throw new Error('历史操作尚未保存完成，请稍后重试')
    if (chat?.pendingStoryAlignment)throw new Error('剧情对账修复尚未完成，请在状态恢复中重新检查并完成修复')
    if (chat) await synchronizeBodyEdits(payload.agent.session, chat, session => sessionStore.flush(session))
    return await foregroundStrategies.prepareStep({
      sessionId,
      payload,
      decision,
      chat,
      requestId: requestIdForMessages(payload.messages)
    })
  })

  const importContextPreparation = createImportContextPreparation({
    readChat: chatForSession, updateChat,
    getSession: id => sessionStore.get(id) || agentRegistry.get(id)?.session,
    flush: session => sessionStore.flush(session),
    modelInfo: request => ctx.llm.resolveModelInfo(request.provider, request.model, request.signal),
    estimateMessage: message => {
      const meter = ctx.get('tokenMeter')
      if (!meter?.estimateMessage) throw new Error('当前宿主缺少原生 token 计量接口，请更新 DSH 后重试')
      const native = meter.estimateMessage(message)
      // The host's fixed four-characters/token estimate underprices CJK text.
      // Use a conservative Unicode floor for this one-time admission check.
      const text = (message.content || []).map(block => block.text || JSON.stringify(block)).join('')
      const nonAscii = [...text].filter(char => char.codePointAt(0) > 127).length
      return Math.max(native, Math.ceil((text.length - nonAscii) / 4) + nonAscii * 2 + 8)
    }
  })
  ctx.on('llm/stream', function (options, next) {
    assertOutboundEnabled()
    const sessionId = str(options && options.sessionId)
    if(backgroundAgentRunner.owns(sessionId)){
      const capped=configuredBackgroundOutput(options,{llm,settings:ctx.get('settings')})
      if(capped!==options)return ctx.llm.stream(capped)
    }
    const coordinates = requestCoordinates.get(sessionId)
    if (coordinates !== undefined) {
      requestCoordinates.set(sessionId, Object.assign({}, coordinates, {
        source: { kind: 'model', provider: str(options.provider), model: str(options.model) }
      }))
    }
    if (options !== null && typeof options === 'object' && options.purpose === 'compaction' && !storyCompactionRequests.has(options)) {
      const fallback = next()
      return (async function * () {
        const chat = await chatForSession(sessionId)
        if (!usesStoryCompaction(chat)) {
          yield * fallback
          return
        }
        if (needsImportContextPreparation(chat)) throw new Error('导入对话尚未完成首次上下文容量检查，暂不调用摘要模型')
        const story = createStoryCompactionRequest(options, runtimePrompt('story-compaction'))
        if (story === options) {
          yield * fallback
          return
        }
        // The latest rounds stay verbatim after the summary (upstream 87b94a5b, 377f70cf).
        const session = sessionStore.get(sessionId) || agentRegistry.get(sessionId)?.session
        const retention = await storyRetention({ sessionId, provider: options.provider, model: options.model, signal: options.signal })
        const prepared = retainRecentStoryRounds(story, retention.rounds - nativelyRetainedRounds(session, story), retention)
        storyCompactionRequests.add(prepared.request)
        yield * withCompactionAppendix(ctx.llm.stream(prepared.request), prepared.appendix)
      })()
    }
    const projectedRequest = (helperRequests.has(options) || fullTemplateRequests.has(options) || importContextPreparation.isPrepared(options)) ? null : foregroundStrategies.projectRequest(options, coordinates)
    if (projectedRequest !== null) return ctx.llm.stream(projectedRequest)
    const backgroundContext = backgroundAgentRunner.requestContext(sessionId)
    const ownerSessionId = backgroundContext ? backgroundContext.parentSessionId : sessionId
    return (async function * () {
      const prepared = (helperRequests.has(options)||fullTemplateRequests.has(options)) ? options : await importContextPreparation.prepare(options)
      if (prepared !== options) { yield * ctx.llm.stream(prepared); return }
      const systemHistoryRequest=projectHelperSystemHistory(options)
      if(systemHistoryRequest!==options){yield*ctx.llm.stream(systemHistoryRequest);return}
      const chat = ownerSessionId === '' ? undefined : await chatForSession(ownerSessionId)
      // Workbench prompts contain source being authored, including incomplete
      // templates. Only play requests execute card templates and prompt events.
      if (chat && ['story', 'script'].includes(chat.mode || 'story') && !backgroundContext && !options.purpose && !fullTemplateRequests.has(options) && !helperRequests.has(options)) {
        const position=requestCoordinates.get(ownerSessionId),identity=position?.turn!==undefined?[chat.timeline?.branchId,position.turn,position.step]:undefined
        let request=options
        // Prompt-ready handlers consume the evaluated text. In particular,
        // keyword replacement must not rewrite identifiers inside EJS source.
        // Finish both processors before re-entering; either output marks the
        // request as prepared, retaining their per-turn retry effect caches.
        if (await fullTemplateEnabled(chat,{texts:options.messages.flatMap(message=>typeof message.content==='string'?[message.content]:(message.content||[]).map(block=>block.text))}) || chat.requestMode!=='sillytavern'&&await lightTemplateEnabled(chat)) {
          await fullTemplateCommitter.flush(ownerSessionId)
          request=await fullTemplateRequests.prepare(ownerSessionId,request,identity)
        }
        if (hasTavernScriptRuntime(chat,await effectiveHelperScripts(chat))) request=await helperRequests.prepare(ownerSessionId,request,identity)
        if (request!==options) { yield * ctx.llm.stream(request); return }
      }
      let requestRecord = null
      if (options.purpose === undefined && chat !== undefined && (chat.mode === 'story' || chat.mode === 'script')) {
        const coordinates = requestCoordinates.get(sessionId) || {}
        requestRecord = await modelRequestLog.record({ chat, context: backgroundContext, coordinates, options })
      }
      let responseText = ''
      let finish = null
      let failure = null
      try {
        let wire = options.sessionId && !options.purpose ? await izumiConnection.wire(options.sessionId) : null
        if(!wire&&chat&&!backgroundContext&&!options.purpose){
          const sampling=presetSampling(chat.resolvedRuntimePreset?.snapshot||effectiveGamePreset(chat));
          if(Object.keys(sampling).length){
            wire=await configuredPresetWire(options,sampling,{llm,settings:ctx.get('settings'),credentials:ctx.get('credentials')});
            if(!wire&&unsupportedPresetSampling(sampling).length)throw Error('当前模型适配器不能传递预设参数：'+unsupportedPresetSampling(sampling).join('、')+'；可选择已配置的 OpenAI 兼容连接');
          }
        }
        if(wire){wire={...wire,outputLimit:configuredOutputLimit(options,{llm,settings:ctx.get('settings')},wire.config.apiUrl),onLimit:notice=>chat?recordModelOutputNotice(chat,notice):undefined}}
        const stream = wire ? streamIzumiConnection(options, wire, { attachments: ctx.get('attachments'), allowedModelOrigins: configuredModelOrigins }) : next()
        for await (const chunk of stream) {
          if (chunk?.type==='text-delta') responseText += str(chunk.text)
          if (chunk?.type==='block-end'&&chunk.block?.type==='text'&&!responseText) responseText=str(chunk.block.text)
          if (chunk && chunk.type === 'finish') {
            finish = chunk.reason === undefined ? chunk : chunk.reason
            if(['error','aborted'].includes(finish.kind))failure=String(presentModelError(new Error(finish.failure?.message|| (finish.kind==='aborted'?'本轮生成已取消。':'模型请求失败。'))).message)
          }
          yield chunk
        }
      } catch (error) {
        const displayedError = chat ? presentModelError(error) : error
        failure = str(displayedError && displayedError.message || displayedError)
        if(!responseText&&error?.partialText)responseText=str(error.partialText)
        throw displayedError
      } finally {
        const completed = Boolean(finish && finish.kind !== 'error' && finish.kind !== 'aborted')
        foregroundStrategies.completeRequest(options, completed)
        if(!completed&&chat&&!backgroundContext&&!options.purpose&&!options.messages.some(row=>row.source?.plugin==='dsh-session-title-llm')&&(failure||options.signal?.aborted)){
          const position=requestCoordinates.get(sessionId)||{}
          try{await turnOrchestrator.recordFailure({sessionId,turn:position.turn,requestId:requestIdForTurn(agentRegistry.get(sessionId)?.session,position.turn),expectedLifecycleRevision:Number(chat.tavernHelperLifecycleRevision||0),code:options.signal?.aborted?'cancelled':'model-request-failed',message:failure||(responseText?'本轮生成已取消，已收到的正文已保留。':'本轮生成已取消。'),partialText:responseText})}
          catch(error){console.error('dsh-tavern: 正文失败记录未保存',String(error.message||error))}
        }
        if (chat && requestRecord) {
          try { await modelRequestLog.complete({ chatId: chat.id, id: requestRecord.id, text: responseText, finish, error: failure }) }
          catch (error) { console.error('dsh-tavern: 模型结果日志写入失败', str(error && error.message || error)) }
        }
      }
    })()
  }, { global: true })

  ctx.on('agent/turn-stopping', async function (payload) {
    const session = payload.agent && payload.agent.session
    if (session === undefined) return
    const sessionId = session.id
    clearRuntimePresetRequestState(payload.agent)
    if (backgroundAgentRunner.owns(sessionId)) return
    const userMessage = userMessageForTurn(session, payload.turn)
    const userText = contentText(userMessage)
    if (userText === ''&&!inputAttachments(userMessage?.content).length&&!isTavernTriggerInput(userMessage)) return
    const requestId = requestIdForTurn(session, payload.turn)
    const assistant = assistantResultForTurn(session, payload.turn)
    if (assistant === null || assistant.text === '') {
      const reasoningOnly = assistant !== null && assistant.reasoningOnly === true
      const message = reasoningOnly
        ? '模型本轮只返回了思考过程，没有返回正文；请重新生成本轮正文。'
        : '模型本轮没有返回正文；请重新生成本轮正文。'
      await turnOrchestrator.recordFailure({
        sessionId,
        turn: payload.turn,
        requestId,
        code: reasoningOnly ? 'reasoning-only' : 'empty-response',
        message
      })
      throw new Error(message)
    }
    const saved = await foregroundHandoff.finalize({
      sessionId,
      turn: payload.turn,
      requestId,
      userText,
      userContent:userMessage?.content,
      assistantText: assistant === null ? '' : assistant.text,
      signal: payload.signal
    })
    if (saved.reply) replaceAssistantReply(session, assistant, saved.reply.sessionText)
  })

  ctx.on('agent/error', async function (payload) {
    clearRuntimePresetRequestState(payload.agent)
    const session=payload.agent?.session
    if(!session||backgroundAgentRunner.owns(session.id))return
    const chat=await chatForSessionReadonly(session.id)
    if(!chat||!['story','script'].includes(chat.mode))return
    await turnOrchestrator.recordFailure({sessionId:session.id,turn:payload.turn,requestId:requestIdForTurn(session,payload.turn),code:'foreground-failed',message:String(presentModelError(payload.error)?.message||'正文生成失败'),partialText:payload.error?.partialText})
  })

  ctx.on('session/event', function (session, event) {
    if (!event || event.type !== 'turn/end') return
    const input = { sessionId: session.id, turn: event.data && event.data.turn, reason: event.data?.reason?.kind || '' }
    const steps = [
      ['回合性能记录', () => performanceDiagnostics.turnEnd(session.id)],
      ['清理回合请求', () => clearRuntimePresetRequestState({ session })],
      ['清理世界书循环', () => fullWorldbookCycles.clear(session.id)],
      ['结束前台策略', () => foregroundStrategies.endTurn(session.id)],
      ['交接后台结算', () => { if (!backgroundAgentRunner.owns(session.id)) foregroundHandoff.end(input) }]
    ]
    for (const [stage, run] of steps) {
      try { run(); runtimeNotices.clear(input, stage) }
      catch (error) { runtimeNotices.report(input, stage, error); console.error('dsh-tavern: ' + stage + '失败', error?.message || error) }
    }
  })

  ctx.on('system-prompt/assemble', async function (_assembly, context, next) {
    const assembly = await next()
    const agent = context && context.agent
    if (agent === undefined || agent.session === undefined) return assembly
    if (backgroundAgentRunner.owns(agent.session.id)) return assembly
    const chat = await chatForSession(agent.session.id)
    if (chat) await synchronizeBodyEdits(agent.session, chat, session => sessionStore.flush(session))
    if (chat && chat.requestMode !== 'sillytavern' && ['story', 'script', 'card'].includes(await turnOrchestrator.modeFor(agent.session.id))) {
      await ensureNativeSystemPrefix(agent.session, chat)
    }
    let workspaceProjection = null
    try { workspaceProjection = await publishResourceWorkspace(agent.session.id, chat) }
    catch { console.error('dsh-tavern: 资源工作区投影刷新失败，继续使用现有资源文件') }
    const assembled = await foregroundStrategies.assembleSystemPrompt(assembly, {
      sessionId: agent.session.id,
      chat,
      cwd: agent.session.header && agent.session.header.cwd,
      workspaceProjection,
      fixedSystemSections: chat && ['story', 'script'].includes(chat.mode || 'story')
        ? withCurrentWorldbook(sessionStablePrefixSections(agent.session), (await nativeWorldBookTemplateContext(chat, await readChatCard(chat),{foreground:true})).context)
        : sessionStablePrefixSections(agent.session)
    })
    return prependSystemInstruction(assembled, chat ? runtimePrompt('system-append') : '')
  })

  // ---------- 模型可选工具 ----------
  const tools = ctx.get('tools')
  if (tools !== undefined) {
    const converter=createMvuConversion({resources:{...fileResources,saveMvuCard:async input=>{
      const policy=await cardPermissions.read({cardPath:input.sourcePath})
      const result=await fileResources.saveMvuCard(input)
      if(input.expectedTargetText===undefined){
        const identity=cardWorkspaceIdentity(result.path,await fileResources.readCard(result.path))
        // This host-created derivative inherits only the source's recorded grant.
        // Later retries never restore permissions explicitly revoked on the copy.
        await cardPermissions.change(identity,identity.digest,policy.capabilities)
      }
      return result
    }}})
    registerMvuConversionTools({tools,defineTool,chatForSession,conversion:{
      convert:args=>(args.action==='apply'?maintenanceGate.write:args.action==='saveDefinition'?maintenanceGate.mutate:maintenanceGate.read)(()=>converter.convert(args)),
      verify:args=>maintenanceGate.read(()=>converter.verify(args))
    }})
    ctx.effect(()=>()=>disposeMvuConversionBrowser())
    tools.register(defineTool({
      name: 'tavern_test_response',
      description: '用正式游玩 API 为已保存人物卡创建独立测试存档，按保存的案例逐轮调用模型并检查拒绝信号。configure 保存案例，start 启动，status 查询（最多等待 10 秒），cancel 停止。最长 5 分钟；真实调用产生费用。不支持浏览器脚本卡。未发现拒绝不等于内容合规。',
      parameters: {
        action: { type: 'string', enum: ['configure', 'start', 'status', 'cancel'], required: true },
        name: { type: 'string', description: 'configure 必填，案例名称。' },
        caseId: { type: 'string', description: 'start 必填，configure 返回的案例 ID。' },
        sourceCard: { type: 'string', description: 'configure 必填，库中人物卡文件名，不含 cards/。' },
        provider: { type: 'string', description: 'configure 必填，用户指定的 provider。' },
        model: { type: 'string', description: 'configure 必填，用户指定的模型。' },
        reasoningEffort: { type: 'string' },
        steps: { type: 'array', description: 'configure 必填，1 至 10 轮。首轮 input；后续可 input 或 inputFrom 二选一。candidates 表示本轮后生成候选项。', items: { type: 'object', additionalProperties: false, properties: {
          input: { type: 'string' },
          inputFrom: { type: 'object', additionalProperties: false, properties: { candidate: { type: 'integer', required: true }, type: { type: 'string', enum: ['action', 'scene'] } } },
          candidates: { type: 'boolean' }
        } } },
        sessionId: { type: 'string', description: 'status/cancel 必填，start 返回的测试会话 ID。' }
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { report: { type: 'string', required: true } } },
        render: function (_args, value) { return [{ type: 'text', text: value.report }] }
      },
      isConcurrencySafe: function () { return false },
      async execute(args, exec) {
        return { report: JSON.stringify(await cardResponseTest.execute(exec?.agent?.session?.id || '', args), null, 2) }
      }
    }))
    tools.register(defineTool({
      name: HISTORY_RECALL_TOOL.name,
      description: HISTORY_RECALL_TOOL.description,
      parameters: dshParameterFields(HISTORY_RECALL_TOOL.parameters),
      output: {
        schema: HISTORY_RECALL_OUTPUT_SCHEMA,
        render: function (_args, value) { return [{ type: 'text', text: renderHistoryRecall(value) }] }
      },
      isConcurrencySafe: function () { return true },
      async execute(args, exec) {
        const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : ''
        return await recallHistoryForSession(sessionId, args)
      }
    }))
    tools.register(defineTool({
      name: WORLD_BOOK_SEARCH_TOOL.name,
      description: WORLD_BOOK_SEARCH_TOOL.description,
      parameters: dshParameterFields(WORLD_BOOK_SEARCH_TOOL.parameters),
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { report: { type: 'string', required: true } } },
        render: function (_args, value) { return [{ type: 'text', text: value.report }] }
      },
      isConcurrencySafe: function () { return false },
      async execute(args, exec) {
        return { report: JSON.stringify(await searchWorldbook(exec?.agent?.session?.id || '', args)) }
      }
    }))
    tools.register(defineTool({
      name: 'tavern_user_profile_read',
      description: '读取 Profile 中独立保存的用户画像草案和已确认版本。建立、复查或修改用户画像时先调用；草案不等于已确认偏好。',
      parameters: {},
      output: {
        schema: { type: 'object', additionalProperties: false, properties: {
          profileName: { type: 'string', required: true },
          hasDraft: { type: 'boolean', required: true },
          hasConfirmed: { type: 'boolean', required: true },
          draftRevision: { type: 'integer', required: true },
          confirmedRevision: { type: 'integer', required: true },
          draftJson: { type: 'string', required: true },
          confirmedJson: { type: 'string', required: true }
        } },
        render: function (_args, value) {
          if (!value.hasDraft && !value.hasConfirmed) return [{ type: 'text', text: '画像“' + value.profileName + '”尚未建立。' }]
          return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
        }
      },
      isConcurrencySafe: function () { return true },
      async execute(_args, exec) {
        const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : ''
        const chat = await chatForSession(sessionId)
        if (chat === undefined || (chat.mode || 'story') !== 'card') throw new Error('用户画像只能在卡片工作台中管理')
        const value = await userPreferenceProfile.read(chat.userProfileManagementId || chat.userProfileId || 'default')
        return {
          profileName: value.name,
          hasDraft: value.hasDraft,
          hasConfirmed: value.hasConfirmed,
          draftRevision: value.hasDraft ? Number(value.draft.revision) || 0 : 0,
          confirmedRevision: value.hasConfirmed ? Number(value.confirmed.profileRevision) || 0 : 0,
          draftJson: value.hasDraft ? JSON.stringify(value.draft, null, 2) : '',
          confirmedJson: value.hasConfirmed ? JSON.stringify(value.confirmed, null, 2) : ''
        }
      }
    }))

    tools.register(defineTool({
      name: 'tavern_user_profile_save_draft',
      description: '保存用户画像草案。只记录问卷原始回答、Agent 分析和拟注入摘要；不会覆盖已确认画像，也不会自动注入游玩。保存后必须向用户展示草案并等待确认。',
      parameters: {
        rawAnswers: {
          type: 'array', required: true,
          items: { type: 'object', additionalProperties: false, properties: {
            question: { type: 'string', required: true },
            answer: { type: 'string', required: true }
          } }
        },
        dimensions: {
          type: 'array', required: true,
          items: { type: 'object', additionalProperties: false, properties: {
            id: { type: 'string', required: true },
            label: { type: 'string', required: true },
            conclusion: { type: 'string', required: true },
            confidence: { type: 'string', required: true, enum: ['confirmed', 'likely', 'uncertain'] },
            evidence: { type: 'string', required: true }
          } }
        },
        summary: { type: 'string', required: true, description: '供用户核对的完整画像草案' },
        injectionText: { type: 'string', required: true, description: '最多约 3000 字的最小充分游玩偏好摘要；不能包含本轮人物卡专属要求' },
        uncertainties: { type: 'array', required: true, items: { type: 'string' } }
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: {
          draftRevision: { type: 'integer', required: true },
          hasConfirmed: { type: 'boolean', required: true }
        } },
        render: function (_args, value) {
          return [{ type: 'text', text: '用户画像草案 v' + value.draftRevision + ' 已保存，尚未确认、不会注入游玩。请先向用户展示并等待明确确认。' }]
        }
      },
      async execute(args, exec) {
        const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : ''
        const chat = await chatForSession(sessionId)
        if (chat === undefined || (chat.mode || 'story') !== 'card') throw new Error('用户画像只能在卡片工作台中管理')
        const value = await userPreferenceProfile.saveDraft({ ...args, profileId: chat.userProfileManagementId || chat.userProfileId || 'default' })
        return { draftRevision: Number(value.draft.revision) || 0, hasConfirmed: value.hasConfirmed }
      }
    }))

    tools.register(defineTool({
      name: 'tavern_user_profile_confirm',
      description: '把刚刚向用户完整展示且由用户明确同意的画像草案保存为确认版。不得把沉默、继续回答、模糊认可或 Agent 自己的判断当作确认。',
      parameters: {
        draftRevision: { type: 'integer', required: true, description: '用户刚刚确认的草案 revision' },
        approvalToken: { type: 'string', required: true, description: '宿主确认界面在用户同意后签发的一次性凭据；不得自行编造' }
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: {
          confirmedRevision: { type: 'integer', required: true }
        } },
        render: function (_args, value) {
          return [{ type: 'text', text: '用户画像已确认保存为 Profile 版本 v' + value.confirmedRevision + '。可在用户画像面板为当前游戏或新游戏启用。' }]
        }
      },
      async execute(args, exec) {
        const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : ''
        const chat = await chatForSession(sessionId)
        if (chat === undefined || (chat.mode || 'story') !== 'card') throw new Error('用户画像只能在卡片工作台中管理')
        const value = await userPreferenceProfile.confirm({ ...args, sessionId, profileId: chat.userProfileManagementId || chat.userProfileId || 'default' })
        return { confirmedRevision: Number(value.confirmed.profileRevision) || 0 }
      }
    }))

    tools.register(defineTool({
      name: 'tavern_save_skill',
      description: '仅当用户明确要求创建或修改 Tavern Skill 时，把结构化内容安全保存到用户 Skill 目录。不能覆盖内置 Skill；修改同名用户 Skill 必须明确 overwrite=true。',
      parameters: {
        name: { type: 'string', required: true, description: 'kebab-case Skill 名称' },
        description: { type: 'string', required: true, description: '用于 Skill 自动发现的一句话简介，说明做什么以及何时使用' },
        body: { type: 'string', required: true, description: '不含 YAML frontmatter 的完整 Markdown 指令正文' },
        purpose: { type: 'string', description: 'card 为卡片工具技能；writing 为可在游玩设置中启停的文风技能' },
        modelInvocable: { type: 'boolean', description: '是否允许 Agent 自动发现，默认 true' },
        userInvocable: { type: 'boolean', description: '是否允许用户显式调用，默认 true' },
        overwrite: { type: 'boolean', description: '同名用户 Skill 已存在且用户明确要求修改时设为 true' }
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            name: { type: 'string', required: true },
            chars: { type: 'integer', required: true },
            overwritten: { type: 'boolean', required: true },
            saved: { type: 'boolean', required: true }
          }
        },
        render: function (_args, value) {
          return [{ type: 'text', text: 'Tavern Skill 已' + (value.overwritten ? '更新' : '创建') + '：' + value.name + ' · ' + value.chars + ' 字；已进入 Skill 目录，不会自动执行。' }]
        }
      },
      async execute(args, exec) {
        const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : ''
        const chat = await chatForSession(sessionId)
        if (chat === undefined || (chat.mode || 'story') !== 'card') throw new Error('Tavern Skill 只能在卡片工作台中创建或修改')
        const saved = await tavernSkills.write(args)
        return { name: saved.name, chars: saved.chars, overwritten: saved.overwritten, saved: true }
      }
    }))

    tools.register(defineTool({
      name: 'tavern_validate_card',
      description: '只读校验人物卡 JSON、字段类型和 MVU 扩展结构。写入后必须调用，始终读取磁盘文件。不会执行脚本、自动修复或覆盖文件。',
      parameters: { path: { type: 'string', description: '可选的 cards/... 相对路径；省略时检查当前已保存人物卡' } },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            valid: { type: 'boolean', required: true },
            errors: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { path: { type: 'string', required: true }, message: { type: 'string', required: true } } } },
            warnings: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { path: { type: 'string', required: true }, message: { type: 'string', required: true } } } }
          }
        },
        render: function (_args, value) { return [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
      },
      isConcurrencySafe: function () { return true },
      async execute(args, exec) {
        const chat = await chatForSession(exec.agent.session.id)
        if (!chat || chat.mode !== 'card') throw new Error('人物卡校验只能在卡片工作台使用')
        const requested = str(args.path).trim()
        const cardPath = requested || str(chat.cardPath)
        const normalized = cardPath ? normalizeResourcePath(cardPath, 'card') : ''
        return await validateCardFile({ path: normalized, readText: fileResources.readText })
      }
    }))

    tools.register(defineTool({
      name: 'tavern_read_card',
      description: '在卡片工作台中按字段、分段读取当前人物卡或尚未创建的新卡设定。默认上下文只有字段目录，先按任务选择字段，不要一次读取全部字段。',
      parameters: {
        path: { type: 'string', description: '可选的人物卡相对路径；省略时读取当前人物卡或尚未创建的新卡设定' },
        field: { type: 'string', required: true, enum: READABLE_CARD_FIELDS, description: '要读取的人物卡字段' },
        offset: { type: 'integer', description: '可选的 1 起始字符位置，默认 1' },
        limit: { type: 'integer', description: '本次最多读取字符数，默认 6000，最大 12000' }
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            field: { type: 'string', required: true },
            text: { type: 'string', required: true },
            totalChars: { type: 'integer', required: true },
            from: { type: 'integer', required: true },
            to: { type: 'integer', required: true },
            done: { type: 'boolean', required: true }
          }
        },
        render: function (_args, value) {
          if (value.totalChars === 0) return [{ type: 'text', text: '人物卡字段 ' + value.field + ' 为空。' }]
          return [{ type: 'text', text: '人物卡字段 ' + value.field + ' · 第 ' + value.from + '~' + value.to + ' 字 / 共 ' + value.totalChars + ' 字\n\n' + value.text }]
        }
      },
      isConcurrencySafe: function () { return true },
      async execute(args, exec) {
        const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : ''
        const chat = await chatForSession(sessionId)
        if (chat === undefined) throw new Error('尚未选择人物卡。')
        if ((chat.mode || 'story') !== 'card') throw new Error('人物卡字段只能在卡片工作台中读取')
        const resourcePath = str(args.path).trim()
        const card = resourcePath !== ''
          ? await readCard(resourcePath)
          : (str(chat.cardPath) === '' ? ((chat.workspace && chat.workspace.draft) || {}) : await readChatCard(chat))
        if (card === undefined) throw new Error('人物卡资源不存在: ' + resourcePath)
        return readCardField(card, args)
      }
    }))

  tools.register(defineTool({
    name: 'tavern_search_card',
    description: '在整张人物卡里定位文字：一次搜遍标准字段、开场、内置世界书条目（标题、关键词、正文）、正则和脚本，返回 JSON Pointer、所属条目与上下文片段。要改的内容不确定在哪、或要改多处时先用它定位，再按位置读取或修改：内置世界书条目用 tavern_update_worldbook（entry:N），标准字段用 tavern_update_card 的 fields，其他用 rawOperations。不搜索绑定的独立世界书。',
    parameters: {
      path: { type: 'string', description: '可选的人物卡相对路径；省略时搜索当前人物卡' },
      query: { type: 'string', required: true, description: '要找的文字；默认按字面匹配，不区分大小写' },
      regex: { type: 'boolean', description: '为 true 时把 query 当作 JavaScript 正则' },
      limit: { type: 'integer', description: '最多返回的命中位置数，默认 30，最大 100' }
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          query: { type: 'string', required: true },
          total: { type: 'integer', required: true },
          occurrences: { type: 'integer', required: true },
          truncated: { type: 'boolean', required: true },
          hits: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
            pointer: { type: 'string', required: true }, label: { type: 'string', required: true }, count: { type: 'integer', required: true },
            chars: { type: 'integer', required: true }, snippets: { type: 'array', required: true, items: { type: 'string' } }
          } } }
        }
      },
      render: function (_args, value) {
        if (value.total === 0) return [{ type: 'text', text: '人物卡中没有找到「' + value.query + '」。' }]
        const lines = ['「' + value.query + '」共 ' + value.occurrences + ' 处，分布在 ' + value.total + ' 个位置' + (value.truncated ? '，仅列出前 ' + value.hits.length + ' 个' : '') + '：']
        for (const hit of value.hits) {
          lines.push('', hit.pointer + (hit.label ? ' · ' + hit.label : '') + ' · ' + hit.count + ' 处 / 全文 ' + hit.chars + ' 字')
          for (const snippet of hit.snippets) lines.push('  ' + snippet.replace(/\n/g, '⏎'))
        }
        return [{ type: 'text', text: lines.join('\n') }]
      }
    },
    isConcurrencySafe: function () { return true },
    async execute(args, exec) {
      const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : ''
      const chat = await chatForSession(sessionId)
      if (chat === undefined || (chat.mode || 'story') !== 'card') throw new Error('人物卡搜索只能在卡片工作台中使用')
      const resourcePath = str(args.path).trim() || str(chat.cardPath)
      if (resourcePath === '') throw new Error('空白工作台还没有正式人物卡')
      const text = await fileResources.readText(normalizeResourcePath(resourcePath, 'card'))
      if (text === undefined) throw new Error('人物卡资源不存在: ' + resourcePath)
      return searchCardRaw(cardPreparation.present({card:JSON.parse(text),as:'raw'}), args)
    }
  }))

    tools.register(defineTool({
      name: 'tavern_read_card_raw',
      description: '在卡片工作台中按 JSON Pointer 分段读取完整工作 raw。只在标准字段工具无法覆盖正则、脚本、MVU 或未知扩展时使用；pointer 为空可查看根结构。',
      parameters: {
        path: { type: 'string', description: '可选的人物卡相对路径；省略时读取当前人物卡' },
        pointer: { type: 'string', description: 'JSON Pointer，例如 /data/extensions/regex_scripts；V1 卡可使用 /extensions。省略时读取根节点' },
        offset: { type: 'integer', description: '可选的 1 起始字符位置，默认 1' },
        limit: { type: 'integer', description: '本次最多读取字符数，默认 6000，最大 12000' }
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            pointer: { type: 'string', required: true },
            text: { type: 'string', required: true },
            totalChars: { type: 'integer', required: true },
            from: { type: 'integer', required: true },
            to: { type: 'integer', required: true },
            done: { type: 'boolean', required: true }
          }
        },
        render: function (_args, value) {
          return [{ type: 'text', text: '人物卡 raw ' + (value.pointer || '/') + ' · 第 ' + value.from + '~' + value.to + ' 字 / 共 ' + value.totalChars + ' 字\n\n' + value.text }]
        }
      },
      isConcurrencySafe: function () { return true },
      async execute(args, exec) {
        const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : ''
        const chat = await chatForSession(sessionId)
        if (chat === undefined || (chat.mode || 'story') !== 'card') throw new Error('人物卡 raw 只能在卡片工作台中读取')
        const resourcePath = str(args.path).trim() || str(chat.cardPath)
        if (resourcePath === '') throw new Error('空白工作台还没有正式人物卡 raw')
        const workspace = await readCardWorkspace(resourcePath)
        if (workspace === undefined) throw new Error('人物卡资源不存在: ' + resourcePath)
        return cardPreparation.present({ card: workspace, as: 'raw-section', pointer: args.pointer, offset: args.offset, limit: args.limit })
      }
    }))

    tools.register(defineTool({
      name: 'tavern_read_play_chat',
      description: '在卡片工作台中渐进读取已挂载的游玩诊断。默认从最新一轮的小型 overview 开始；需要时可列出轮次、读取任意轮次或整场对话，并按层、分页获取文本、状态、日志、真实模型请求、正则诊断和 iframe 证据。',
      parameters: {
        ref: { type: 'string', description: '已挂载游玩记录引用，例如 play-chat:chat-xxx；只有一个引用时可省略' },
        turn: { type: 'integer', description: '要读取的游玩轮次；省略时使用最新一轮' },
        layer: { type: 'string', enum: ['overview', 'turns', 'conversation', 'input', 'source', 'session', 'display', 'saved-display', 'diagnostics', 'tavern', 'foreground', 'background', 'request', 'iframe'], description: '读取层：小型概览、轮次目录、整场对话、本轮玩家输入、模型原文、Session 文本、当前实时展示、保存时展示快照、当前正则诊断、Tavern 状态、前台 Agent、后台 Agent、真实模型请求或 iframe 运行证据；默认 overview' },
        offset: { type: 'integer', description: '可选的 1 起始字符位置，默认 1' },
        limit: { type: 'integer', description: '本次最多读取字符数，默认 6000，最大 12000' }
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            ref: { type: 'string', required: true },
            chatId: { type: 'string', required: true },
            turn: { type: 'integer', required: true },
            layer: { type: 'string', required: true },
            text: { type: 'string', required: true },
            totalChars: { type: 'integer', required: true },
            from: { type: 'integer', required: true },
            to: { type: 'integer', required: true },
            done: { type: 'boolean', required: true },
            cardSnapshotVersion: { type: 'integer', required: true },
            cardSnapshotDigest: { type: 'string', required: true }
          }
        },
        render: function (_args, value) {
          return [{ type: 'text', text: '游玩记录第 ' + value.turn + ' 轮 · ' + value.layer + ' · 第 ' + value.from + '~' + value.to + ' 字 / 共 ' + value.totalChars + ' 字 · 人物卡快照 v' + value.cardSnapshotVersion + ' (' + (value.cardSnapshotDigest || '无摘要') + ')\n\n' + value.text }]
        }
      },
      isConcurrencySafe: function () { return true },
      async execute(args, exec) {
        const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : ''
        const editorChat = await chatForSession(sessionId)
        if (editorChat === undefined || (editorChat.mode || 'story') !== 'card') throw new Error('游玩记录只能在卡片工作台中读取')
        const references = Array.isArray(editorChat.workspace && editorChat.workspace.mountedResources)
          ? editorChat.workspace.mountedResources.filter(function (item) { return item && item.kind === 'play-chat' })
          : []
        const requestedRef = str(args.ref).trim()
        const reference = requestedRef === ''
          ? (references.length === 1 ? references[0] : null)
          : references.find(function (item) { return item.path === requestedRef })
        if (reference === null || reference === undefined) throw new Error(references.length > 1 ? '请指定要读取的游玩记录 ref' : '当前卡片工作台没有挂载游玩记录')
        const sourceChat = await readChat(reference.chatId)
        if (sourceChat === undefined) throw new Error('游玩记录已不存在')
        let projector = null
        if (str(args.layer) === 'diagnostics' || str(args.layer) === 'display') {
          const extensions = await readCardExtensions(editorChat.cardPath)
          projector = function (message) {
            return projectRuntimeReply(str(message.sourceText) || str(message.text), {
              charName: sourceChat.cardName,
              macroState: sourceChat.macroState,
              projectionText: Object.prototype.hasOwnProperty.call(message, 'projectionText') ? str(message.projectionText) : (str(message.sourceText) || str(message.text)),
              regexScripts: Array.isArray(extensions && extensions.regexScripts) ? extensions.regexScripts : [],
              placement: 2,
              isEdit: false,
              depth: 0
            })
          }
        }
        const foregroundId = str(sourceChat.sessionId)
        const backgroundId = str(sourceChat.timeline && sourceChat.timeline.participants && sourceChat.timeline.participants.background && sourceChat.timeline.participants.background.sessionId) || str(sourceChat.candidateAgent && sourceChat.candidateAgent.sessionId)
        return readPlayChatDebugTurn(editorChat, sourceChat, reference, args, projector, {
          displayRuntime: message=>displayDiagnostics.read(sourceChat,message),
          foreground: sessionDebugEvidence(foregroundId),
          background: sessionDebugEvidence(backgroundId),
          requests: await modelRequestLog.evidence(sourceChat.id, args.turn || reference.turn)
        })
      }
    }))

    const scriptOutput = {
      type: 'object', additionalProperties: false,
      properties: {
        found: { type: 'boolean', required: true },
        message: { type: 'string', required: true },
        title: { type: 'string', required: true },
        totalChunks: { type: 'integer', required: true },
        from: { type: 'integer', required: true },
        to: { type: 'integer', required: true },
        cursor: { type: 'integer', required: true },
        chunks: {
          type: 'array', required: true,
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              id: { type: 'string', required: true },
              number: { type: 'integer', required: true },
              text: { type: 'string', required: true }
            }
          }
        }
      }
    }
    tools.register(defineTool({
      name: 'tavern_read_script',
      description: '按需读取已绑定剧本。剧本游玩中优先读取当前游标附近；卡片设定中可检索整本剧本。',
      parameters: {
        path: { type: 'string', description: '卡片工作台中可指定剧本相对路径；游玩模式省略并读取当前人物卡绑定剧本' },
        query: { type: 'string', description: '可选关键词；剧本游玩只检索当前游标前后 10 块' },
        offset: { type: 'integer', description: '可选的 1 起始块号' },
        limit: { type: 'integer', description: '连续读取块数；游玩最多 21，卡片设定最多 6' }
      },
      output: {
        schema: scriptOutput,
        render: function (_args, value) {
          if (!value.found) return [{ type: 'text', text: value.message }]
          const body = value.chunks.map(function (chunk) { return '[' + chunk.id + ' · 第 ' + chunk.number + ' 块]\n' + chunk.text }).join('\n\n')
          return [{ type: 'text', text: '剧本《' + value.title + '》第 ' + value.from + '~' + value.to + ' 块 / 共 ' + value.totalChunks + ' 块\n\n' + body }]
        }
      },
      isConcurrencySafe: function () { return true },
      async execute(args, exec) {
        const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : ''
        const chat = await chatForSession(sessionId)
        if (chat === undefined) return { found: false, message: '尚未选择人物卡。', title: '', totalChunks: 0, from: 0, to: 0, cursor: 0, chunks: [] }
        const mode = chat.mode || 'story'
        if (mode !== 'script' && mode !== 'card') throw new Error('当前模式不能读取剧本')
        const requestedPath = str(args.path).trim()
        const resourcePath = mode === 'card' && requestedPath !== '' ? requestedPath : str(chat.cardPath)
        if (resourcePath === '') return { found: false, message: '当前工作台尚未指定人物卡或剧本。', title: '', totalChunks: 0, from: 0, to: 0, cursor: 0, chunks: [] }
        const script = await readScript(resourcePath)
        if (script === undefined || !Array.isArray(script.chunks) || script.chunks.length === 0) return { found: false, message: '当前人物卡没有绑定剧本。', title: '', totalChunks: 0, from: 0, to: 0, cursor: 0, chunks: [] }
        const windowResult = scriptContinuity.inspect({
          script,
          state: chat.scriptState,
          request: { kind: mode === 'script' ? 'play' : 'read', query: args.query, offset: args.offset, limit: args.limit }
        })
        if (windowResult.notFound === true || windowResult.chunks.length === 0) {
          return {
            found: false,
            message: windowResult.notFound === true ? '没有找到包含该关键词的剧本分块。' : '剧本分块为空。',
            title: str(windowResult.title), totalChunks: Number(windowResult.total) || 0,
            from: 0, to: 0, cursor: Number(windowResult.cursor) || 0, chunks: []
          }
        }
            return {
              found: true, message: '', title: str(windowResult.title), totalChunks: Number(windowResult.total) || 0,
              from: Number(windowResult.from) || 0, to: Number(windowResult.to) || 0, cursor: Number(windowResult.cursor) || 0,
              chunks: windowResult.chunks.map(function (chunk) {
                const project = mode === 'card' ? preserveRuntimeSource : projectAgentContent
                const projected = project(chunk.text, { charName: str(chat.cardName), macroState: chat.macroState })
                return { id: str(chunk.id), number: Number(chunk.order) + 1, text: projected.agentText }
              })
            }
      }
    }))

    tools.register(defineTool({
      name: 'tavern_read_worldbook',
      description: '在卡片设定对话中按编号、关键词或分页读取世界书正文。省略 path 时读取当前人物卡绑定的世界书。',
      parameters: {
        path: { type: 'string', description: '世界书相对路径；独立世界书为 worldbooks/...，人物卡内置世界书为 cards/...' },
        ref: { type: 'string', description: '目录中的条目编号，例如 entry:0' },
        query: { type: 'string', description: '可选关键词' },
        offset: { type: 'integer', description: '可选的 1 起始条目序号' },
        limit: { type: 'integer', description: '读取 1~10 条，默认 3' },
        charOffset: { type: 'integer', description: '所选条目文本的 1 起始字符偏移，续读使用上页 to + 1；保持条目筛选参数不变' },
        charLimit: { type: 'integer', description: '单页字符数，默认 6000，最多 12000' }
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            found: { type: 'boolean', required: true },
            message: { type: 'string', required: true },
            name: { type: 'string', required: true },
            total: { type: 'integer', required: true },
            ...TOOL_READ_PAGE_SCHEMA
          }
        },
        render: function (_args, value) {
          if (!value.found) return [{ type: 'text', text: value.message }]
          return [{ type: 'text', text: '世界书《' + (value.name || '未命名') + '》· 共 ' + value.total + ' 条 · 第 ' + value.from + '~' + value.to + ' 字 / 共 ' + value.totalChars + ' 字' + (value.done ? '（读取完成）' : '；续读 charOffset=' + (value.to + 1)) + '\n\n' + value.text }]
        }
      },
      isConcurrencySafe: function () { return true },
      async execute(args, exec) {
        const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : ''
        const chat = await chatForSession(sessionId)
        if (chat === undefined) return { found: false, message: '尚未选择人物卡。', name: '', total: 0, ...readToolPage('') }
        if ((chat.mode || 'story') !== 'card') throw new Error('世界书只能在卡片工作台中读取')
        const requestedPath = str(args.path).trim()
        let record
        if (requestedPath !== '') {
          const normalized = normalizeResourcePath(requestedPath)
          const kind = resourceKind(normalized)
          if (kind !== 'worldbook' && kind !== 'card') throw new Error('世界书引用路径类型不正确')
          record = await worldBooks.get(kind === 'card' ? { kind: 'card', cardPath: normalized } : { kind: 'standalone', path: normalized })
        } else {
          if (str(chat.cardPath) === '') return { found: false, message: '当前工作台尚未引用世界书。', name: '', total: 0, ...readToolPage('') }
          record = await worldBooks.bound(chat.cardPath, await readChatCard(chat), chat)
          if (record === null) return { found: false, message: '当前人物卡没有世界书。', name: '', total: 0, ...readToolPage('') }
        }
        const allEntries = Array.isArray(record.view.entries) ? record.view.entries : []
        const query = str(args.query).trim().toLowerCase()
        const ref = str(args.ref).trim()
        const filtered = allEntries.filter(function (entry) {
          if (ref !== '') return str(entry.ref) === ref
          if (query === '') return true
          return JSON.stringify(entry).toLowerCase().includes(query)
        })
        const offset = Math.max(1, Number(args.offset) || 1)
        const limit = Math.min(10, Math.max(1, Number(args.limit) || 3))
        const entries = filtered.slice(offset - 1, offset - 1 + limit).map(function (entry) { return { ref: str(entry.ref), entry } })
        if (entries.length === 0) return { found: false, message: '没有找到符合条件的世界书条目。', name: str(record.view.displayName).slice(0, 200), total: allEntries.length, ...readToolPage('') }
        const text = entries.map(item => '[' + item.ref + ']\n' + JSON.stringify(item.entry, null, 2)).join('\n\n')
        return { found: true, message: '', name: str(record.view.displayName).slice(0, 200), total: allEntries.length, ...readToolPage(text, { offset: args.charOffset, limit: args.charLimit }) }
      }
    }))

    tools.register(defineTool({
      name: 'tavern_update_worldbook',
      description: '仅在用户明确确认后，对世界书提交条目级最小修改。支持独立世界书和人物卡内置世界书；省略 path 时修改当前人物卡绑定的世界书。不要重写整本世界书。',
      parameters: {
        path: { type: 'string', description: '可选的世界书路径；省略时使用当前人物卡，或填写 worldbooks/...、cards/...' },
        name: { type: 'string', description: '可选的新世界书名称' },
        description: { type: 'string', description: '可选的新世界书说明' },
        operations: {
          type: 'array', required: true,
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              op: { type: 'string', required: true, enum: ['update', 'add', 'delete'] },
              ref: { type: 'string' },
              patch: { type: 'object', additionalProperties: true, description: 'update 的字段，与 entry 使用相同字段名' },
              entry: { type: 'object', additionalProperties: true, description: 'add 的新条目字段：comment 标题、content 正文、primaryKeys 关键词数组、secondaryKeys、enabled、constant、order 等；不使用 keys/key' }
            }
          }
        }
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            path: { type: 'string', required: true },
            name: { type: 'string', required: true },
            entryCount: { type: 'integer', required: true },
            saved: { type: 'boolean', required: true }
          }
        },
        render: function (_args, value) { return [{ type: 'text', text: '世界书《' + value.name + '》已修改并生效 · ' + value.entryCount + ' 条' }] }
      },
      async execute(args, exec) {
        const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : ''
        const chat = await chatForSession(sessionId)
        if (chat === undefined || (chat.mode || 'story') !== 'card') throw new Error('世界书只能在卡片工作台中修改')
        const requestedPath = str(args.path).trim()
        if (requestedPath === '' && str(chat.cardPath) === '') throw new Error('当前工作台尚未绑定人物卡，无法修改世界书')
        const normalized = requestedPath === '' ? normalizeResourcePath(chat.cardPath, 'card') : normalizeResourcePath(requestedPath)
        const kind = resourceKind(normalized)
        if (kind !== 'worldbook' && kind !== 'card') throw new Error('世界书引用路径类型不正确')
        const source = kind === 'card' ? { kind: 'card', cardPath: normalized } : { kind: 'standalone', path: normalized }
        assertWorldBookPatchFields(args.operations)
        const request = { operations: args.operations }
        if (Object.prototype.hasOwnProperty.call(args, 'name')) request.name = args.name
        if (Object.prototype.hasOwnProperty.call(args, 'description')) request.description = args.description
        const result = await worldBooks.update(source, request)
        return { path: normalized, name: str(result.view.displayName), entryCount: Number(result.view.entryCount) || 0, saved: true }
      }
    }))

    tools.register(defineTool({
      name: 'tavern_read_preset',
      description: '按 JSON Pointer 分段读取预设的原始工作 JSON。目标预设只用于编辑，不会应用到当前 Agent。',
      parameters: {
        path: { type: 'string', required: true, description: 'presets/... 相对路径' },
        pointer: { type: 'string', description: 'JSON Pointer，例如 /prompts/0；省略时读取根节点' },
        offset: { type: 'integer', description: '可选的 1 起始字符位置' },
        limit: { type: 'integer', description: '本次最多读取字符数，默认 6000，最大 12000' }
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            path: { type: 'string', required: true }, pointer: { type: 'string', required: true }, text: { type: 'string', required: true },
            totalChars: { type: 'integer', required: true }, from: { type: 'integer', required: true }, to: { type: 'integer', required: true }, done: { type: 'boolean', required: true }
          }
        },
        render: function (_args, value) { return [{ type: 'text', text: '预设 ' + value.path + ' · ' + (value.pointer || '/') + ' · 第 ' + value.from + '~' + value.to + ' 字 / 共 ' + value.totalChars + ' 字\n\n' + value.text }] }
      },
      isConcurrencySafe: function () { return true },
      async execute(args, exec) {
        const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : ''
        const chat = await chatForSession(sessionId)
        if (chat === undefined || (chat.mode || 'story') !== 'card') throw new Error('预设只能在卡片工作台中读取')
        const normalized = normalizeResourcePath(args.path, 'preset')
        return await presetEditor.read(normalized, args)
      }
    }))

    tools.register(defineTool({
      name: 'tavern_update_preset',
      description: '仅在用户明确确认后，按 JSON Pointer 修改预设的最小路径并重新校验。不会应用或运行目标预设。',
      parameters: {
        path: { type: 'string', required: true, description: 'presets/... 相对路径' },
        operations: {
          type: 'array', required: true,
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              op: { type: 'string', required: true, enum: ['set', 'delete'] },
              path: { type: 'string', required: true, description: 'JSON Pointer，例如 /prompts/0/content' },
              value: { type: 'json', description: 'set 操作的新值；delete 时省略' }
            }
          }
        }
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            path: { type: 'string', required: true }, changed: { type: 'array', required: true, items: { type: 'string' } },
            valid: { type: 'boolean', required: true }, recognized: { type: 'boolean', required: true }, promptCount: { type: 'integer', required: true },
            regexCount: { type: 'integer', required: true }, warning: { type: 'string', required: true }
          }
        },
        render: function (_args, value) { return [{ type: 'text', text: '预设已修改并通过 JSON 校验；变更 ' + value.changed.length + ' 个路径。目标预设仍未应用。' + (value.warning ? '\n诊断：' + value.warning : '') }] }
      },
      async execute(args, exec) {
        const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : ''
        const chat = await chatForSession(sessionId)
        if (chat === undefined || (chat.mode || 'story') !== 'card') throw new Error('预设只能在卡片工作台中修改')
        const normalized = normalizeResourcePath(args.path, 'preset')
        return await presetEditor.update(normalized, args.operations)
      }
    }))

    tools.register(defineTool({
      name: 'tavern_update_card',
      description: '仅当用户明确要求或确认修改时，立即保存最小的人物卡变更；保存后调用 tavern_validate_card 检查实际文件。空白工作台会直接创建并绑定正式人物卡文件，必须同时具备角色名和玩家身份。只讨论时不要调用。',
      parameters: {
        fields: {
          type: 'object', additionalProperties: false,
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            personality: { type: 'string' },
            scenario: { type: 'string' },
            first_mes: { type: 'string' },
            mes_example: { type: 'string' },
            system_prompt: { type: 'string' },
            post_history_instructions: { type: 'string' },
            creator_notes: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
            alternate_greetings: { type: 'array', items: { type: 'string' } },
            player: { type: 'string', description: '新建人物卡时用于约束 {{user}} 视角的玩家身份' }
          }
        },
        rawOperations: {
          type: 'array',
          description: '仅用于标准字段和专用资源工具无法覆盖的扩展字段；不能修改世界书。按 JSON Pointer 对完整工作 raw 做最小 set/delete 修改',
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              op: { type: 'string', required: true, enum: ['set', 'delete'] },
              path: { type: 'string', required: true, description: 'JSON Pointer，例如 /data/extensions/regex_scripts/0/disabled' },
              value: { type: 'json', description: 'set 操作的新值；delete 时省略' }
            }
          }
        }
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            saved: { type: 'boolean', required: true },
            mode: { type: 'string', required: true, enum: ['card'] },
            changed: { type: 'boolean', required: true },
            createsCard: { type: 'boolean', required: true },
            changedFields: { type: 'array', required: true, items: { type: 'string' } }
          }
        },
        render: function (_args, value) {
          const detail = value.changedFields.length > 0 ? '：' + value.changedFields.join('、') : ''
          if (value.createsCard) return [{ type: 'text', text: '已创建并绑定正式人物卡' + detail }]
          if (!value.changed) return [{ type: 'text', text: '提交内容与当前设定相同，无需改动' }]
          return [{ type: 'text', text: '已保存人物卡变更' + detail }]
        }
      },
      async execute(args, exec) {
        const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : ''
        return await turnOrchestrator.saveChanges({
          sessionId,
          turn: activeTurnOf(exec),
          fields: args.fields,
          rawOperations: args.rawOperations
        })
      }
    }))

  tools.register(defineTool({
    name: 'tavern_replace_card_text',
    description: '仅当用户明确要求修改时，在整张人物卡里批量替换文字并立即保存：标准字段、开场、内置世界书条目（标题、关键词、正文）、正则和脚本一次改完，保存后自动校验。结果列出每个位置替换了几处、全卡剩余几处，以此为准，无需再搜索或用脚本复核。只想改部分位置时用 pointers 限定（可填 tavern_search_card 返回的 pointer 或其上级，如 /data/character_book/entries/8）；填 expectedCount 时实际处数不符则不改；任一范围或格式错误均零写入。path 必须为当前工作台绑定的卡。不处理绑定的独立世界书。',
    parameters: {
      path: { type: 'string', description: '可选的人物卡路径；省略时修改当前人物卡' },
      find: { type: 'string', required: true, description: '要替换的文字；默认按字面匹配，不区分大小写' },
      replace: { type: 'string', required: true, description: '替换成的文字；regex 为 true 时可用 $1 等引用分组' },
      regex: { type: 'boolean', description: '为 true 时把 find 当作 JavaScript 正则' },
      pointers: { type: 'array', items: { type: 'string' }, description: '可选，只替换这些 JSON Pointer 位置及其下级' },
      expectedCount: { type: 'integer', description: '可选，预期替换的总处数；不符时不保存并返回实际分布' }
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          saved: { type: 'boolean', required: true },
          warnings: { type: 'array', required: true, items: { type: 'string' } },
          path: { type: 'string', required: true },
          replaced: { type: 'integer', required: true },
          remaining: { type: 'integer', required: true },
          locations: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
            pointer: { type: 'string', required: true }, label: { type: 'string', required: true }, count: { type: 'integer', required: true } } } },
          validation: { type: 'json' }
        }
      },
      render: function (_args, value) {
        const lines = ['已在 ' + value.path + ' 替换 ' + value.replaced + ' 处，全卡剩余 ' + value.remaining + ' 处：']
        for (const item of value.locations) lines.push('- ' + item.pointer + (item.label ? ' · ' + item.label : '') + ' · ' + item.count + ' 处')
        if (value.validation) lines.push(JSON.stringify(value.validation))
        lines.push(...value.warnings)
        return [{ type: 'text', text: lines.join('\n') }]
      }
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const sessionId = exec?.agent?.session?.id || ''
      const chat = await chatForSession(sessionId)
      return replaceCardText(chat, args, { beforeCommit: async () => {
        const current = await chatForSession(sessionId)
        if (!current || current.mode !== 'card' || current.cardPath !== chat.cardPath) throw Error('工作台绑定已变化，未保存')
      } })
    }
  }))

    tools.register(defineTool({
      name: 'tavern_restore_card',
      description: '灾难恢复工具：仅当用户明确要求将当前正式人物卡从 originals 原版整体恢复、已获知会覆盖全部工作版修改，并再次明确确认后使用。普通编辑、撤销、不确定或空白工作台严禁调用。恢复前会自动备份当前工作版。',
      parameters: {
        approvalToken: {
          type: 'string',
          required: true,
          description: '宿主确认界面针对当前会话和人物卡版本签发的一次性凭据；不得自行编造'
        },
        expectedDigest: {type:'string',required:true,description:'用户确认时的人物卡内容摘要'}
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            path: { type: 'string', required: true },
            name: { type: 'string', required: true },
            originalPath: { type: 'string', required: true },
            backupPath: { type: 'string', required: true }
          }
        },
        render: function (_args, value) {
          return [{ type: 'text', text: '人物卡《' + value.name + '》已从原版恢复并立即生效。恢复前工作版已备份到 ' + value.backupPath }]
        }
      },
      async execute(args, exec) {
        const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : ''
        const turn = activeTurnOf(exec)
        return await restoreCurrentCard(sessionId,args.approvalToken,args.expectedDigest,async () => {
          if (turn > 0) await turnOrchestrator.discard({sessionId,turn})
        })
      }
    }))
  }

  try {
    const recoveredIndex = await initializeRuntimeState()
    await recoverRuntimeHistory(recoveredIndex)
    settleRuntimeReadiness({ ok: true })
  } catch (error) {
    settleRuntimeReadiness({ ok: false, error })
    throw error
  }
}
