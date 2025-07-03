/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { MarkdownString as BaseMarkdownString, MarkdownStringTrustedOptions } from '../../../vs/base/common/htmlContent';

export class MarkdownString implements vscode.MarkdownString {

	__vscodeBrand: undefined;

	readonly delegate: BaseMarkdownString;

	static isMarkdownString(thing: any): thing is vscode.MarkdownString {
		if (thing instanceof MarkdownString) {
			return true;
		}
		return thing && thing.appendCodeblock && thing.appendMarkdown && thing.appendText && (thing.value !== undefined);
	}

	constructor(value?: string, supportThemeIcons: boolean = false) {
		this.delegate = new BaseMarkdownString(value, { supportThemeIcons });
	}

	get value(): string {
		return this.delegate.value;
	}
	set value(value: string) {
		this.delegate.value = value;
	}

	get isTrusted(): boolean | MarkdownStringTrustedOptions | undefined {
		return this.delegate.isTrusted;
	}

	set isTrusted(value: boolean | MarkdownStringTrustedOptions | undefined) {
		this.delegate.isTrusted = value;
	}

	get supportThemeIcons(): boolean | undefined {
		return this.delegate.supportThemeIcons;
	}

	set supportThemeIcons(value: boolean | undefined) {
		this.delegate.supportThemeIcons = value;
	}

	get supportHtml(): boolean | undefined {
		return this.delegate.supportHtml;
	}

	set supportHtml(value: boolean | undefined) {
		this.delegate.supportHtml = value;
	}

	get baseUri(): vscode.Uri | undefined {
		return this.delegate.baseUri;
	}

	set baseUri(value: vscode.Uri | undefined) {
		this.delegate.baseUri = value;
	}

	appendText(value: string): vscode.MarkdownString {
		this.delegate.appendText(value);
		return this;
	}

	appendMarkdown(value: string): vscode.MarkdownString {
		this.delegate.appendMarkdown(value);
		return this;
	}

	appendCodeblock(value: string, language?: string): vscode.MarkdownString {
		this.delegate.appendCodeblock(language ?? '', value);
		return this;
	}
}
