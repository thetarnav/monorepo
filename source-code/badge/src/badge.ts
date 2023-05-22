import satori from "satori"
import clone from "./repo/clone.js"
import { setupConfig } from "@inlang/core/config"
import { initialize$import, type InlangEnvironment } from "@inlang/core/environment"
import { getLintReports, lint } from "@inlang/core/lint"
import { createMemoryFs } from "@inlang-git/fs"
import { getRessourcePercentages, removeCommas } from "./helper/index.js"
import { markup } from "./helper/markup.js"
import { readFileSync } from "node:fs"
import { telemetryNode } from "@inlang/telemetry"
import { query } from "@inlang/core/query"

const fontMedium = readFileSync(new URL("./assets/static/Inter-Medium.ttf", import.meta.url))
const fontBold = readFileSync(new URL("./assets/static/Inter-Bold.ttf", import.meta.url))

export const badge = async (url: string, preferredLanguage: string | undefined) => {
	// initialize a new file system on each request to prevent cross request pollution
	const fs = createMemoryFs()
	await clone(url, fs)

	// Set up the environment functions
	const env: InlangEnvironment = {
		$import: initialize$import({
			fs,
			fetch,
		}),
		$fs: fs,
	}

	// Get the content of the inlang.config.js file
	const file = await fs.readFile("/inlang.config.js", { encoding: "utf-8" }).catch((e) => {
		if (e.code !== "ENOENT") throw e
		throw new Error("No inlang.config.js file found in the repository.")
	})

	const config = await setupConfig({
		module: await import("data:application/javascript;base64," + btoa(file.toString())),
		env,
	})

	const resources = await config.readResources({ config })

	// Get ressources with lints
	const [resourcesWithLints, errors] = await lint({ resources, config })
	if (errors) {
		console.error("lints partially failed", errors)
	}

	const lints = getLintReports(resourcesWithLints)

	// calculate the percentages
	const percentages = getRessourcePercentages(resourcesWithLints)

	if (!percentages) {
		// TODO: render a badge that says "no translations found. Please add translations to your project"
		throw new Error("No translations found. Please add translations to your project.")
	}

	// If preferred language is not set, set it to english
	if (!preferredLanguage) {
		preferredLanguage = "en"
	}

	// Remove the region from the language
	if (preferredLanguage?.includes("-")) {
		preferredLanguage = preferredLanguage.split("-")[0]
	}

	// find in resources the resource from the preferredLanguage
	const referenceResource = resources.find(
		(resource) => resource.languageTag.name === config.referenceLanguage,
	)
	if (!referenceResource) {
		throw new Error("No referenceLanguage found, please add one to your inlang.config.js")
	}

	// get all the ids from the preferredLanguageResource
	const referenceIds = query(referenceResource).includedMessageIds()
	const numberOfMissingMessages: { language: string; id: string }[] = []

	// loop through all the resources and check if the ids are included in the preferredLanguageResource
	for (const resource of resources) {
		const language = resource.languageTag.name
		for (const id of referenceIds) {
			if (query(resource).get({ id }) === undefined) {
				numberOfMissingMessages.push({
					language,
					id,
				})
			}
		}
	}

	// filter number of missing messages by preferredLanguage
	const numberOfMissingMessagesInPreferredLanguage = numberOfMissingMessages.filter(
		(message) => message.language === preferredLanguage,
	).length

	// markup the percentages
	const [host, owner, repository] = [...url.split("/")]
	const vdom = removeCommas(
		markup(
			percentages,
			preferredLanguage,
			numberOfMissingMessages.length,
			numberOfMissingMessagesInPreferredLanguage,
			lints,
		),
	)

	// render the image
	const image = await satori(
		// @ts-ignore
		vdom,
		{
			width: 340,
			height: 180,
			fonts: [
				{
					name: "Inter Medium",
					weight: 500,
					data: fontMedium,
				},
				{
					name: "Inter Bold",
					weight: 700,
					data: fontBold,
				},
			],
		},
	)

	telemetryNode.capture({
		event: "BADGE created",
		distinctId: "unknown",
		properties: {
			host,
			owner,
			repository,
		},
	})

	// return image
	return image
}
