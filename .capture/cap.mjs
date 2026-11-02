import mqtt from 'mqtt';
import fs from 'fs';

const client = mqtt.connect('mqtt://wmc.ms.wits.ac.za:1883', {
  username: 'student',
  password: 'arl-exam',
  connectTimeout: 8000,
  reconnectPeriod: 0
});

const cap = { topologies: {}, telemetry: {}, state: {} };

client.on('connect', () => {
  const subs = [
    'arl/rta/$topology', 'arl/lwm/$topology', 'arl/opg/$topology',
    'arl/rta/+/telemetry/+', 'arl/lwm/+/telemetry/+', 'arl/opg/+/telemetry/+',
    'arl/rta/+/state/+', 'arl/lwm/+/state/+', 'arl/opg/+/state/+'
  ];
  client.subscribe(subs, { qos: 0 });
});

client.on('message', (topic, payload) => {
  const txt = payload.toString();
  if (topic.endsWith('/$topology')) {
    cap.topologies[topic] = txt;
  } else if (topic.includes('/telemetry/')) {
    if (!cap.telemetry[topic]) cap.telemetry[topic] = [];
    if (cap.telemetry[topic].length < 2) cap.telemetry[topic].push(txt);
  } else if (topic.includes('/state/')) {
    if (!cap.state[topic]) cap.state[topic] = [];
    if (cap.state[topic].length < 1) cap.state[topic].push(txt);
  }
});

client.on('error', (e) => { console.error('ERR', e.message); process.exit(1); });

setTimeout(() => {
  fs.writeFileSync('./.capture/cap.json', JSON.stringify(cap, null, 2));
  console.log('saved. topologies:', Object.keys(cap.topologies).length,
    'telemetry:', Object.keys(cap.telemetry).length,
    'state:', Object.keys(cap.state).length);
  client.end();
  process.exit(0);
}, 18000);
