import {createHash} from 'node:crypto'
// The template build replaces this module with the browser implementation.
export const sha256Hex = value => createHash('sha256').update(value).digest('hex')
