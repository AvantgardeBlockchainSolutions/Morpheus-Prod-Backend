const express = require('express');
const fs = require('fs');
const { ethers } = require('ethers');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = 3000;

// Configuration
const jsonFilePath = './mintEvents.json';
const processedEventsFilePath = './processedEvents.json';
const contractAddress = '0xf8c4B0E8322eBec10580e34667210386007c4398';
const provider = new ethers.JsonRpcProvider('https://eth.llamarpc.com');
const abi = [
    "event MintExecuted(address indexed user, uint256 morpheusAmount, uint32 indexed mintCycleId)"
];
const contract = new ethers.Contract(contractAddress, abi, provider);

let events = [];
if (fs.existsSync(jsonFilePath)) {
    events = JSON.parse(fs.readFileSync(jsonFilePath));
} else {
    fs.writeFileSync(jsonFilePath, JSON.stringify(events));
}

let processedEvents = new Set();
if (fs.existsSync(processedEventsFilePath)) {
    const savedProcessedEvents = JSON.parse(fs.readFileSync(processedEventsFilePath));
    processedEvents = new Set(savedProcessedEvents);
} else {
    fs.writeFileSync(processedEventsFilePath, JSON.stringify([...processedEvents]));
}

const conversionFactors = {
    1: 1.0,
    2: 0.96,
    3: 0.92,
    4: 0.88,
    5: 0.84,
    6: 0.80,
    7: 0.76,
    8: 0.72,
    9: 0.68,
    10: 0.64,
    11: 0.60,
    12: 0.56,
    13: 0.52,
    14: 0.48,
};

const saveEventsToFile = () => {
    events.sort((a, b) => (BigInt(b.titanXAmount) > BigInt(a.titanXAmount) ? 1 : -1));
    fs.writeFileSync(jsonFilePath, JSON.stringify(events));
};

const saveProcessedEventsToFile = () => {
    fs.writeFileSync(processedEventsFilePath, JSON.stringify([...processedEvents]));
};

const addOrUpdateUserEvent = (user, morpheusAmount, cycleId) => {
    const conversionFactor = conversionFactors[cycleId] || 1.0;
    const titanXAmount = (BigInt(morpheusAmount) * 100n) / BigInt(Math.round(conversionFactor * 100));

    const userEvent = events.find(event => event.user === user);

    if (userEvent) {
        userEvent.morpheusAmount = (BigInt(userEvent.morpheusAmount) + BigInt(morpheusAmount)).toString();
        userEvent.titanXAmount = (BigInt(userEvent.titanXAmount) + titanXAmount).toString();
    } else {
        events.push({
            user,
            morpheusAmount: morpheusAmount.toString(),
            titanXAmount: titanXAmount.toString()
        });
    }
    saveEventsToFile();
};

const fetchHistoricalEvents = async (startingBlock) => {
    const filter = contract.filters.MintExecuted();
    const latestBlock = await provider.getBlockNumber();

    const logs = await contract.queryFilter(filter, startingBlock, latestBlock);
    logs.forEach(log => {
        const { user, morpheusAmount, mintCycleId } = log.args;
        const eventId = `${log.transactionHash}-${log.logIndex}`;

        if (!processedEvents.has(eventId)) {
            addOrUpdateUserEvent(user, morpheusAmount.toString(), mintCycleId);
            processedEvents.add(eventId);
            console.log(`Processed event for user: ${user}`);
        }
    });

    saveProcessedEventsToFile();
    console.log(`Fetched historical events from block ${startingBlock} to ${latestBlock}`);
};

let latestBlockProcessed;
const pollForNewEvents = async () => {
    console.log('Polling for new events...');
    const filter = contract.filters.MintExecuted();
    const latestBlock = await provider.getBlockNumber();

    if (!latestBlockProcessed) latestBlockProcessed = latestBlock;
    
    if (latestBlock > latestBlockProcessed) {
        const logs = await contract.queryFilter(filter, latestBlockProcessed + 1, latestBlock);
        logs.forEach(log => {
            const { user, morpheusAmount, mintCycleId } = log.args;
            const eventId = `${log.transactionHash}-${log.logIndex}`;

            if (!processedEvents.has(eventId)) {
                addOrUpdateUserEvent(user, morpheusAmount.toString(), mintCycleId);
                processedEvents.add(eventId);
                console.log(`New event processed for user: ${user}`);
            }
        });
        latestBlockProcessed = latestBlock;
        saveProcessedEventsToFile();
    } else {
        console.log('No new events found');
    }
};

const limiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 5,
    message: "Too many requests from this IP, please try again after 1 minute."
});

app.get('/mintEvents', limiter, (req, res) => {
    res.json(events);
});

app.listen(PORT, async () => {
    console.log(`API is running on http://localhost:${PORT}`);
    const startingBlock = 21065598;
    await fetchHistoricalEvents(startingBlock);

    setInterval(pollForNewEvents, 15000);
    console.log('Polling for new MintExecuted events...');
});
