// The public entry remains stable for journals, migration and recovery callers.
// V3 also decodes legacy ordinary JSON and v1/v2 content-addressed snapshots.
export {createChatResourceCodecV3 as createChatResourceCodec} from './chat-resource-codec-v3.js'
