/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IEnvService } from '../../../env/common/envService';
import { FetchOptions, IAbortController, IFetcherService, Response } from '../../common/fetcherService';
import { NodeFetchFetcher } from '../nodeFetchFetcher';

export class NodeFetcherService implements IFetcherService {

	declare readonly _serviceBrand: undefined;

	private readonly _fetcher = new NodeFetchFetcher(this._envService);

	constructor(
		@IEnvService private readonly _envService: IEnvService
	) { }

	getUserAgentLibrary(): string {
		return this._fetcher.getUserAgentLibrary();
	}

	fetch(url: string, options: FetchOptions): Promise<Response> {
		return this._fetcher.fetch(url, options);
	}
	disconnectAll(): Promise<unknown> {
		return this._fetcher.disconnectAll();
	}
	makeAbortController(): IAbortController {
		return this._fetcher.makeAbortController();
	}
	isAbortError(e: any): boolean {
		return this._fetcher.isAbortError(e);
	}
	isInternetDisconnectedError(e: any): boolean {
		return this._fetcher.isInternetDisconnectedError(e);
	}
	isFetcherError(e: any): boolean {
		return this._fetcher.isFetcherError(e);
	}
	getUserMessageForFetcherError(err: any): string {
		return this._fetcher.getUserMessageForFetcherError(err);
	}
}
