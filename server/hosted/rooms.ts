import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { AppState } from '../state'
import type { User } from './auth'
import { claudeEnv, readClaudeLogin } from './claude'
import { userDir } from './files'

// Each signed-in user gets a room shared by their devices (canvas sync, AI requests, MCP tools).
// The AI runs only for users who connected their own Claude account.
interface Room {
	state: AppState
	mcpKey: string // secret part of this room's MCP URL; only the server's own agent uses it
}
const rooms = new Map<string, Room>()
let port = 3001

export function setRoomsPort(p: number) {
	port = p
}

export function roomFor(user: Pick<User, 'id'>) {
	let room = rooms.get(user.id)
	if (!room) {
		const state = new AppState()
		state.lanPairing = false
		room = { state, mcpKey: randomBytes(24).toString('base64url') }
		rooms.set(user.id, room)
		attachClaude(user, room)
	}
	return room.state
}

export function roomByMcpKey(key: string) {
	for (const r of rooms.values()) if (r.mcpKey === key) return r.state
	return null
}

export function releaseRoom(user: Pick<User, 'id'>) {
	const room = rooms.get(user.id)
	if (room?.state.empty && !room.state.agent?.busy) {
		room.state.dropAgent()
		rooms.delete(user.id)
	}
}

function attachClaude(user: Pick<User, 'id'>, room: Room) {
	const login = readClaudeLogin(user)
	if (!login) return room.state.dropAgent()
	room.state.initAgent(port, {
		mcpUrl: `http://127.0.0.1:${port}/mcp/${room.mcpKey}`,
		env: { ...claudeEnv(login), CLAUDE_CONFIG_DIR: join(userDir(user), 'claude-config') },
		cwd: userDir(user),
	})
}

// After the user connects or disconnects their Claude account.
export function refreshClaude(user: Pick<User, 'id'>) {
	const room = rooms.get(user.id)
	if (room) attachClaude(user, room)
}
