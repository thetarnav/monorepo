/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { Command } from "commander"
import { rpc } from "@inlang/rpc"
import { getInlangProject } from "../../utilities/getInlangProject.js"
import { log } from "../../utilities/log.js"
import { type InlangProject, ProjectSettings } from "@inlang/sdk"
import prompts from "prompts"
import { projectOption } from "../../utilities/globalFlags.js"

export const translate = new Command()
	.command("translate")
	.requiredOption(projectOption.flags, projectOption.description)
	.option("-f, --force", "Force machine translation and skip the confirmation prompt.", false)
	.option("--sourceLanguageTag <source>", "Source language tag for translation.")
	.option(
		"--targetLanguageTags <targets...>",
		"Comma separated list of target language tags for translation."
	)
	.description("Machine translate all resources.")
	.action(async (args: { force: boolean; project: string }) => {
		try {
			// Prompt the user to confirm
			if (!args.force) {
				log.warn(
					"Human translations are better than machine translations. \n\nWe advise to use machine translations in the build step without commiting them to the repo. By using machine translate in the build step, you avoid missing translations in production while still flagging to human translators that transaltions are missing. You can use the force flag (-f, --force) to skip this prompt warning."
				)
				const response = await prompts({
					type: "confirm",
					name: "value",
					message: "Are you sure you want to machine translate?",
				})
				if (!response.value) {
					log.warn("Aborting machine translation.")
					return
				}
			}

			const project = await getInlangProject({ projectPath: args.project })

			translateCommandAction({ project })
		} catch (error) {
			log.error(error)
		}
	})

export async function translateCommandAction(args: { project: InlangProject }) {
	try {
		const options = translate.opts()
		const projectConfig = args.project.settings()

		if (!projectConfig) {
			log.error(`No inlang project found`)
			return
		}

		const allLanguageTags = [...projectConfig.languageTags, projectConfig.sourceLanguageTag]

		const sourceLanguageTag: ProjectSettings["sourceLanguageTag"] =
			options.sourceLanguageTag || projectConfig.sourceLanguageTag
		if (!sourceLanguageTag) {
			log.error(
				`No source language tag defined. Please define a source language tag in the project.inlang.json file or as an argument with --sourceLanguageTag.`
			)
			return
		}
		if (options.sourceLanguageTag && !allLanguageTags.includes(options.sourceLanguageTag)) {
			log.error(
				`The source language tag "${options.sourceLanguageTag}" is not included in the project settings sourceLanguageTag & languageTags. Possible language tags are ${allLanguageTags}.`
			)
			return
		}

		const targetLanguageTags: ProjectSettings["languageTags"] = options.targetLanguageTags
			? options.targetLanguageTags[0]?.split(",")
			: projectConfig.languageTags
		if (!targetLanguageTags) {
			log.error(
				`No language tags defined. Please define languageTags in the project.inlang.json file or as an argument with --targetLanguageTags.`
			)
			return
		}
		if (
			options.targetLanguageTags &&
			!targetLanguageTags.every((tag) => allLanguageTags.includes(tag))
		) {
			log.error(
				`Some or all of the language tags "${options.targetLanguageTags}" are not included in the project settings sourceLanguageTag & languageTags. Possible language tags are ${allLanguageTags}.`
			)
			return
		}

		log.info(`📝 Translating to ${targetLanguageTags.length} languages.`)

		// parallelize in the future
		for (const id of args.project.query.messages.includedMessageIds()) {
			const { data: translatedMessage, error } = await rpc.machineTranslateMessage({
				message: args.project.query.messages.get({ where: { id } })!,
				sourceLanguageTag,
				targetLanguageTags,
			})
			if (error) {
				log.error(`Couldn't translate message "${id}": ${error}`)
				continue
			}

			args.project.query.messages.update({ where: { id: id }, data: translatedMessage! })
			log.info(`Machine translated message "${id}"`)
		}
		// Log the message counts
		log.success("Machine translate complete.")
	} catch (error) {
		log.error(error)
	}
}
