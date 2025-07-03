/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { BasePromptElementProps, PromptElement, PromptElementProps } from '@vscode/prompt-tsx';
import type * as vscode from 'vscode';
import { ILanguageDiagnosticsService } from '../../../platform/languages/common/languageDiagnosticsService';
import { IPromptPathRepresentationService } from '../../../platform/prompts/common/promptPathRepresentationService';
import { IWorkspaceService } from '../../../platform/workspace/common/workspaceService';
import { getLanguage } from '../../../util/common/languages';
import { isLocation } from '../../../util/common/types';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { URI } from '../../../util/vs/base/common/uri';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { DiagnosticSeverity, ExtendedLanguageModelToolResult, LanguageModelPromptTsxPart, MarkdownString, Range } from '../../../vscodeTypes';
import { findDiagnosticForSelectionAndPrompt } from '../../context/node/resolvers/fixSelection';
import { IBuildPromptContext } from '../../prompt/common/intents';
import { renderPromptElementJSON } from '../../prompts/node/base/promptRenderer';
import { Tag } from '../../prompts/node/base/tag';
import { DiagnosticContext, Diagnostics } from '../../prompts/node/inline/diagnosticsContext';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';
import { checkCancellation, formatUriForFileWidget, resolveToolInputPath } from './toolUtils';

interface IGetErrorsParams {
	filePaths: string[];
	// sparse array of ranges, as numbers because it goes through JSON
	ranges?: ([a: number, b: number, c: number, d: number] | undefined)[];
}

class GetErrorsTool extends Disposable implements ICopilotTool<IGetErrorsParams> {
	public static readonly toolName = ToolName.GetErrors;

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ILanguageDiagnosticsService private readonly languageDiagnosticsService: ILanguageDiagnosticsService,
		@IWorkspaceService private readonly workspaceService: IWorkspaceService,
		@IPromptPathRepresentationService private readonly promptPathRepresentationService: IPromptPathRepresentationService,
	) {
		super();
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IGetErrorsParams>, token: CancellationToken) {
		const diagnostics = await Promise.all(options.input.filePaths.map(async (filePath, i): Promise<{ context: DiagnosticContext; uri: URI; diagnostics: vscode.Diagnostic[] }> => {
			const uri = resolveToolInputPath(filePath, this.promptPathRepresentationService);
			const range = options.input.ranges?.[i];
			if (!uri) {
				throw new Error(`Invalid input path ${filePath}`);
			}

			let diagnostics = range
				? findDiagnosticForSelectionAndPrompt(this.languageDiagnosticsService, uri, new Range(...range), undefined)
				: this.languageDiagnosticsService.getDiagnostics(uri);

			diagnostics = diagnostics.filter(d => d.severity <= DiagnosticSeverity.Warning);

			const document = await this.workspaceService.openTextDocumentAndSnapshot(uri);
			checkCancellation(token);

			return {
				context: { document, language: getLanguage(document) },
				diagnostics,
				uri,
			};
		}));

		checkCancellation(token);

		const result = new ExtendedLanguageModelToolResult([
			new LanguageModelPromptTsxPart(
				await renderPromptElementJSON(this.instantiationService, DiagnosticToolOutput, { diagnosticsGroups: diagnostics, maxDiagnostics: 50 }, options.tokenizationOptions, token)
			)
		]);

		const numDiagnostics = diagnostics.reduce((acc, { diagnostics }) => acc + diagnostics.length, 0);
		result.toolResultMessage = numDiagnostics === 0 ?
			new MarkdownString(l10n.t`Checked ${this.formatURIs(diagnostics.map(d => d.uri))}, no problems found`) :
			numDiagnostics === 1 ?
				new MarkdownString(l10n.t`Checked ${this.formatURIs(diagnostics.map(d => d.uri))}, 1 problem found`) :
				new MarkdownString(l10n.t`Checked ${this.formatURIs(diagnostics.map(d => d.uri))}, ${numDiagnostics} problems found`);
		return result;
	}

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IGetErrorsParams>, token: vscode.CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		if (!options.input.filePaths?.length) {
			throw new Error('No file paths provided');
		}

		const uris = options.input.filePaths.map(filePath => resolveToolInputPath(filePath, this.promptPathRepresentationService));
		if (uris.some(uri => uri === undefined)) {
			throw new Error('Invalid file path provided');
		}

		return {
			invocationMessage: new MarkdownString(l10n.t`Checking ${this.formatURIs(uris)}`),
		};
	}

	private formatURIs(uris: URI[]): string {
		return uris.map(formatUriForFileWidget).join(', ');
	}

	async provideInput(promptContext: IBuildPromptContext): Promise<IGetErrorsParams | undefined> {
		const seen = new Set<string>();

		const filePaths: string[] = [];
		const ranges: ([a: number, b: number, c: number, d: number] | undefined)[] = [];

		function addPath(path: string, range: vscode.Range | undefined) {
			if (!seen.has(path)) {
				seen.add(path);
				filePaths.push(path);
				ranges.push(range && [range.start.line, range.start.character, range.end.line, range.end.character]);
			}
		}

		for (const ref of promptContext.chatVariables) {
			if (URI.isUri(ref.value)) {
				addPath(this.promptPathRepresentationService.getFilePath(ref.value), undefined);
			} else if (isLocation(ref.value)) {
				addPath(this.promptPathRepresentationService.getFilePath(ref.value.uri), ref.value.range);
			}
		}

		if (promptContext.workingSet) {
			for (const file of promptContext.workingSet) {
				addPath(this.promptPathRepresentationService.getFilePath(file.document.uri), file.range);
			}
		}

		if (!filePaths.length) {
			for (const [uri, diags] of this.languageDiagnosticsService.getAllDiagnostics()) {
				const path = this.promptPathRepresentationService.getFilePath(uri);
				if (diags.length) {
					let range = diags[0].range;
					for (let i = 1; i < diags.length; i++) {
						range = range.union(diags[i].range);
					}
					addPath(path, range);
				}
			}
		}

		return {
			filePaths,
			ranges
		};
	}
}

ToolRegistry.registerTool(GetErrorsTool);

interface IDiagnosticToolOutputProps extends BasePromptElementProps {
	diagnosticsGroups: { context: DiagnosticContext; uri: URI; diagnostics: vscode.Diagnostic[] }[];
	maxDiagnostics?: number;
}

export class DiagnosticToolOutput extends PromptElement<IDiagnosticToolOutputProps> {
	constructor(
		props: PromptElementProps<IDiagnosticToolOutputProps>,
		@IPromptPathRepresentationService private readonly promptPathRepresentationService: IPromptPathRepresentationService,
	) {
		super(props);
	}

	render() {
		if (!this.props.diagnosticsGroups.length) {
			return <>No errors found.</>;
		}

		let diagnosticsGroups = this.props.diagnosticsGroups;
		let limitMsg;
		if (typeof this.props.maxDiagnostics === 'number') {
			let remaining = this.props.maxDiagnostics;
			diagnosticsGroups = this.props.diagnosticsGroups.map(group => {
				if (remaining <= 0) {
					return { ...group, diagnostics: [] };
				}
				const take = Math.min(group.diagnostics.length, remaining);
				remaining -= take;
				return { ...group, diagnostics: group.diagnostics.slice(0, take) };
			});
			const totalDiagnostics = this.props.diagnosticsGroups.reduce((acc, group) => acc + group.diagnostics.length, 0);
			limitMsg = totalDiagnostics > this.props.maxDiagnostics
				? <>Showing first {this.props.maxDiagnostics} results out of {totalDiagnostics}<br /></>
				: undefined;
		}

		return <>
			{limitMsg}
			{diagnosticsGroups.map(d =>
				<Tag name='errors' attrs={{ path: this.promptPathRepresentationService.getFilePath(d.uri) }}>
					{d.diagnostics.length
						? <Diagnostics
							documentContext={d.context}
							diagnostics={d.diagnostics}
							includeRelatedInfos={false} // avoid blowing up the prompt #12655
						/>
						: 'No errors found'}
				</Tag>
			)}
		</>;
	}
}
