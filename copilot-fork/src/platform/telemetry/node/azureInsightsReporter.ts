/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Need to set this env variable even before import to avoid stat beat
process.env.APPLICATION_INSIGHTS_NO_STATSBEAT = 'true';

import * as appInsights from 'applicationinsights';
import * as os from 'os';
import type { TelemetrySender } from 'vscode';
import { ICAPIClientService } from '../../endpoint/common/capiClient';
import { IEnvService } from '../../env/common/envService';
import { TelemetryProperties } from '../common/telemetry';

export class AzureInsightReporter implements TelemetrySender {
	private readonly client: appInsights.TelemetryClient;
	constructor(capiClientService: ICAPIClientService, envService: IEnvService, private readonly namespace: string, key: string) {
		this.client = createAppInsightsClient(capiClientService, envService, key);
		configureReporter(capiClientService, envService, this.client);
	}

	private separateData(data: Record<string, any>): { properties: Record<string, any>; measurements: Record<string, number> } {
		if (data.properties !== undefined || data.measurements !== undefined) {
			data.properties = data.properties || {};
			data.measurements = data.measurements || {};
			return data as { properties: Record<string, any>; measurements: Record<string, number> };
		}
		const properties: Record<string, any> = {};
		const measurements: Record<string, number> = {};
		for (const [key, value] of Object.entries(data)) {
			if (typeof value === 'number') {
				measurements[key] = value;
			} else {
				properties[key] = value;
			}
		}
		return { properties, measurements };
	}

	sendEventData(eventName: string, data?: Record<string, any> | undefined): void {
		const { properties, measurements } = this.separateData(data || {});
		this.client.trackEvent({
			name: this.qualifyEventName(eventName),
			properties,
			measurements,
		});
	}

	sendErrorData(error: Error, data?: Record<string, any> | undefined): void {
		const { properties, measurements } = this.separateData(data || {});
		this.client.trackException({
			exception: error,
			properties,
			measurements,
		});
	}

	flush(): void | Thenable<void> {
		return new Promise(resolve => {
			this.client.flush({
				callback: () => {
					resolve(undefined);
				},
			});
		});
	}

	private qualifyEventName(eventName: string): string {
		return eventName.includes(this.namespace) ? eventName : `${this.namespace}/${eventName}`;
	}
}

function createAppInsightsClient(capiClientService: ICAPIClientService, envService: IEnvService, key: string) {
	const client = new appInsights.TelemetryClient(key);
	client.config.enableAutoCollectRequests = false;
	client.config.enableAutoCollectPerformance = false;
	client.config.enableAutoCollectExceptions = false;
	client.config.enableAutoCollectConsole = false;
	client.config.enableAutoCollectDependencies = false;
	(client.config as any).noDiagnosticChannel = true;

	configureReporter(capiClientService, envService, client);
	return client;
}

function configureReporter(capiClientService: ICAPIClientService, envService: IEnvService, client: appInsights.TelemetryClient): void {
	client.commonProperties = decorateWithCommonProperties(client.commonProperties, envService);
	// Do not want personal machine names to be sent
	client.context.tags[client.context.keys.cloudRoleInstance] = 'REDACTED';

	client.config.endpointUrl = capiClientService.copilotTelemetryURL;
}

function decorateWithCommonProperties(properties: TelemetryProperties, envService: IEnvService): TelemetryProperties {
	properties = properties || {};
	properties['common_os'] = os.platform();
	properties['common_platformversion'] = os.release();
	properties['common_arch'] = os.arch();
	properties['common_cpu'] = Array.from(new Set(os.cpus().map(c => c.model))).join();

	// We have editor-agnostic fields but keep the vs-specific ones for backward compatibility
	properties['common_vscodemachineid'] = envService.machineId;
	properties['common_vscodesessionid'] = envService.sessionId;

	properties['common_uikind'] = 'desktop';
	properties['common_remotename'] = 'none';
	properties['common_isnewappinstall'] = '';
	return properties;
}
