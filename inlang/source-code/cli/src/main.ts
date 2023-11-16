import { Command } from "commander"
import { machine } from "./commands/machine/index.js"
import { module } from "./commands/module/index.js"
import { version } from "../package.json"
import consola, { Consola } from "consola"
import { initErrorMonitoring } from "./services/error-monitoring/implementation.js"
import { open } from "./commands/open/index.js"
import { gitOrigin, telemetry } from "./services/telemetry/implementation.js"
import fetchPolyfill from "node-fetch"
import { lint } from "./commands/lint/index.js"
import { project } from "./commands/project/index.js"
import {
	getCurrentVersion,
	getLatestVersion,
	isMajorVersionUpdate,
	updateToLatest,
} from "./utilities/versioning.js"
// --------------- INIT ---------------

// polyfilling node < 18 with fetch
// see https://github.com/osmosis-labs/osmosis-frontend/pull/1575#pullrequestreview-1434480086
if (typeof fetch === "undefined") {
	globalThis.fetch = fetchPolyfill as any
}

initErrorMonitoring()
// checks whether the gitOrigin corresponds to the pattern
// beautiful logging
;(consola as unknown as Consola).wrapConsole()

/**
 * Wrapper to exit the process if the user presses CTRL+C.
 */
const prompt: typeof consola.prompt = async (message, options) => {
	const response = await consola.prompt(message, options)
	if (response?.toString() === "Symbol(clack:cancel)") {
		process.exit(0)
	}
	return response
}

// --------------- CLI ---------------

export const cli = new Command()
	// Settings
	.name("inlang")
	.version(version)
	.description("CLI for inlang.")
	// Commands
	.addCommand(project)
	.addCommand(lint)
	.addCommand(machine)
	.addCommand(open)
	.addCommand(module)
	// Hooks
	.hook("preAction", async (command) => {
		// name enables better grouping in the telemetry dashboard
		const name = command.args.filter(
			// shouldn't start with a flag and the previous arg shouldn't be a flag
			(arg, i) => !arg.startsWith("-") && !command.args[i - 1]?.startsWith("-")
		)
		telemetry.capture({
			event: `CLI command executed`,
			properties: {
				name: name.join(" "),
				args: command.args.join(" "),
			},
		})
		// Check for the latest version and notify if there's a major version update
		const latestVersion = getLatestVersion()
		const currentVersion = getCurrentVersion()
		if (latestVersion && currentVersion) {
			if (isMajorVersionUpdate(currentVersion, latestVersion)) {
				console.info(`A major update to (${latestVersion}) is available.`)
				const userResponse = await prompt(`Do you want to update to the latest version?`, {
					initial: true,
					type: "confirm",
				})
				if (userResponse === true) {
					console.info("Updating to the latest...")
					updateToLatest(true)
				} else {
					console.info("Continuing with the current version...")
				}
			} else {
				updateToLatest()
			}
		}
	})

// --------------- TELEMETRY ---------------

// not using await to not block the CLI

telemetry.capture({
	event: "CLI started",
	properties: {
		version,
	},
})
telemetry.groupIdentify({
	groupType: "repository",
	groupKey: gitOrigin,
	properties: {
		name: gitOrigin,
	},
})
