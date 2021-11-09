import { DatabaseManager, EventContext, StoreContext, SubstrateBlock } from "@subsquid/hydra-common";
import { Auction, AuctionParachain, Bid, Chronicle, Parachain, ParachainLeases } from "../generated/model";
import { Auctions } from "../types";
import { apiService } from "./helpers/api";
import { ChronicleKey } from '../constants';
import { ensureFund, ensureParachain, getByAuctionParachain, getByAuctions, getLatestCrowdloanId, getOrCreate, getOrUpdate, isFundAddress } from "./helpers/common";

export async function handlerEmpty () {};

export async function handleAuctionStarted({
  store,
  event,
  block
}: EventContext & StoreContext): Promise<void> {
  console.info(` ------ [Auctions] [AuctionStarted] Event Started.`);

  const [auctionId, slotStart, auctionEnds] = new Auctions.AuctionStartedEvent(event).params;

  const api = await apiService();
  const endingPeriod =await  api.consts.auctions.endingPeriod.toJSON() as number;
  const leasePeriod = await api.consts.slots.leasePeriod.toJSON() as number;
  const periods = await api.consts.auctions.leasePeriodsPerSlot.toJSON() as number;

  const auction = await getOrCreate(store, Auction, auctionId.toString());

  auction.blockNum = block.height;
  auction.status = "Started";
  auction.slotsStart = slotStart.toNumber();
  auction.slotsEnd = slotStart.toNumber() + periods - 1;
  auction.leaseStart = slotStart.toNumber() * leasePeriod;
  auction.leaseEnd = (slotStart.toNumber() + periods - 1) * leasePeriod;
  auction.closingStart = auctionEnds.toNumber();
  auction.closingEnd = auctionEnds.toNumber() + endingPeriod;
  auction.ongoing = true;
  await store.save(auction);

  const chronicle = await getOrCreate(store, Chronicle, "ChronicleKey");
  chronicle.curAuctionId = auctionId.toString();
  await store.save(chronicle);

  console.info(` ------ [Auctions] [AuctionStarted] Event Completed.`);
}

export async function handleAuctionClosed({
  store,
  event,
  block,
}: EventContext & StoreContext): Promise<void> {
  console.info(` ------ [Auctions] [AuctionClosed] Event Started.`);

  const [auctionId] = new Auctions.AuctionClosedEvent(event).params;
  const auction = await getOrCreate(store, Auction, auctionId.toString());

  let api = await apiService();
  const endingPeriod = await api.consts.auctions.endingPeriod.toJSON() as number;
  const periods = await api.consts.auctions.leasePeriodsPerSlot.toJSON() as number;
  const leasePeriod = await api.consts.slots.leasePeriod.toJSON() as number;

  auction.blockNum = block.height;
  auction.status = "Closed";
  auction.ongoing = false;
  auction.slotsStart = leasePeriod;
  auction.slotsEnd = leasePeriod + periods - 1;
  auction.closingStart = leasePeriod;
  auction.closingEnd = leasePeriod + endingPeriod;

  await store.save(auction);

  const chronicle = await getOrCreate(store, Chronicle, "ChronicleKey");
  chronicle.curAuctionId = auctionId.toString();
  await store.save(chronicle);  

  console.info(` ------ [Auctions] [AuctionClosed] Event Completed.`);
}

export async function handleAuctionWinningOffset ({
  store,
  event,
  block,
}: EventContext & StoreContext): Promise<void> {
  console.info(` ------ [Auctions] [WinningOffset] Event Started.`);

  const [auctionId, offsetBlock] = new Auctions.WinningOffsetEvent(event).params;
  const auction = await getByAuctions(store, auctionId.toString()) as Auction[];

  if(auction.length != 0) {
    let auctionData = auction[0]
    auctionData.resultBlock = auctionData.closingStart + offsetBlock.toNumber();
    console.info(`Update auction ${auctionId} winning offset: ${auctionData.resultBlock}`);
    await store.save(auctionData);
  }

  console.info(` ------ [Auctions] [WinningOffset] Event Completed.`);
};


const markLosingBids = async (auctionId: number, slotStart: number, slotEnd: number, winningBidId: string, store: DatabaseManager) => {
  const winningBids = (await store.find(Bid, {
    where: {winningAuction: auctionId}
  }))
  const losingBids = winningBids?.filter(
    ({ firstSlot, lastSlot, id }) => id !== winningBidId && slotStart == firstSlot && slotEnd == lastSlot
  ) ||  []
  for (const bid of losingBids) {
    bid.winningAuction = null;
    await store.save(bid)
    console.info(`Mark Bid as losing bid ${bid.id}`);
  }
};

const markParachainLeases = async (
  auctionId: number,
  paraId: number,
  leaseStart: number,
  leaseEnd: number,
  bidAmount: number,
  store: DatabaseManager
) => {
  const leaseRange = `${auctionId}-${leaseStart}-${leaseEnd}`;
  const { id: parachainId } = await ensureParachain(paraId, store);
  const winningLeases = await store.find(ParachainLeases,
    {
      where: {leaseRange: leaseRange}
    })
  const losingLeases = winningLeases?.filter((lease) => lease.paraId !== paraId) || []
  for (const lease of losingLeases) {
    lease.activeForAuction = null;
    store.save(lease)
    console.info(`Mark losing parachain leases ${lease.paraId} for ${lease.leaseRange}`);
  }
  await getOrUpdate(store, ParachainLeases, `${paraId}-${leaseRange}`, {
    paraId,
    leaseRange,
    parachainId,
    firstLease: leaseStart,
    lastLease: leaseEnd,
    auctionId: auctionId?.toString(),
    latestBidAmount: bidAmount,
    activeForAuction: auctionId?.toString(),
    hasWon: false
  });
};

/**
 *
 * @param substrateEvent SubstrateEvent
 * Create Bid record and create auction parachain record if not exists already
 * Skip winning bid before we have query abilities
 */
export const handleBidAccepted = async ({
  store,
  event,
  block,
}: EventContext & StoreContext): Promise<void> => {
const api = await apiService()
  const blockNum = block.height
  const [from, paraId, amount, firstSlot, lastSlot] = new Auctions.BidAcceptedEvent(event).params
  const auctionId = (await api.query.auctions.auctionCounter()).toJSON() as number;
  const isFund = await isFundAddress(from.toString());
  const parachain = await ensureParachain(paraId.toNumber(), store);
  const { id: parachainId } = parachain;

  const fundId = await getLatestCrowdloanId(parachainId, store);
  const bidAmount = amount.toNumber()
  const bid = {
    id: `${blockNum}-${from}-${paraId}-${firstSlot}-${lastSlot}`,
    auctionId: `${auctionId}`,
    blockNum,
    winningAuction: auctionId,
    parachainId,
    isCrowdloan: isFund,
    amount: amount.toNumber(),
    firstSlot,
    lastSlot,
    createdAt : block.timestamp,
    fundId: isFund ? fundId : null,
    bidder: isFund ? null : from
  };

  await store.save(bid);

  await markParachainLeases(auctionId, paraId.toNumber(), firstSlot.toNumber(), lastSlot.toNumber(), bidAmount, store);

  await markLosingBids(auctionId, firstSlot.toNumber(), lastSlot.toNumber(), bid.id, store);

  const auctionParaId = `${paraId}-${firstSlot}-${lastSlot}-${auctionId}`;
  const auctionPara = await store.find(AuctionParachain, {
    where: {id: auctionParaId}
  })
  if (!auctionPara) {
    let parachain = await store.find(Parachain, {
      where:{id: parachainId}
    })
    let auction = await store.find(Auction, {
      where: {id: auctionId.toString()}
    })
    let newAuctionPara = new AuctionParachain({
        id: `${paraId}-${firstSlot}-${lastSlot}-${auctionId}`,
        parachain: parachain[0],
        auction: auction[0],
        firstSlot: firstSlot.toNumber(),
        lastSlot: lastSlot.toNumber(),
        createdAt: new Date(block.timestamp),
        blockNum
    })
     await store.save(newAuctionPara);
  }
};

export const updateBlockNum = async (block: SubstrateBlock, store : DatabaseManager) => {
  await getOrUpdate<Chronicle>(store, Chronicle, ChronicleKey, {
    curBlockNum: block.height
  });
};

export const updateWinningBlocks = async (block: SubstrateBlock, store: DatabaseManager) => {
  const { curAuctionId, curBlockNum  } = (await store.find(Chronicle,{
where: {id:ChronicleKey}
  }))[0] || {};
  const { closingStart, closingEnd } = (await store.find(Auction,{
    where: {id:curAuctionId || ''}
      }))[0] || {};
      let currentBlockNumber = curBlockNum || -1;
  if (curAuctionId && currentBlockNumber >= closingStart && currentBlockNumber < closingEnd) {
    const winningLeases = await store.find(ParachainLeases, {
      where: { id: curAuctionId}});
    for (const lease of winningLeases) {
      lease.numBlockWon = (lease.numBlockWon || 0) + 1;
      await store.save(lease)
    }
  }
};

// export async function handleBidAccepted({
//   store,
//   event,
//   block,
// }: EventContext & StoreContext): Promise<void> {
//   console.info(` ------ [Auctions] [BidAccepted] Event Started.`);
  
  
  
  
  // const { timestamp: createdAt, height: blockNum, id: blockId  } = block;
  // const [from, paraId, amount, firstSlot, lastSlot] = new Auctions.BidAcceptedEvent(event).params;
  // const api = await apiService();
  // const auctionId = (await api.query.auctions.auctionCounter()).toJSON() as number;


  // // const auction = await getOrCreate(store, Auction, auctionId.toString());
  // // const parachainId = (await getParachainId(paraId.toNumber())) as any;
  // // const parachain = await ensureParachain(paraId.toNumber(), store);
  // const { id: parachainId } = await ensureParachain(paraId.toNumber(), store);

  // const isFund = await isFundAddress(from.toHex());
  // const fund = await ensureFund(paraId.toNumber(), store);
  // const fundIdAlpha = await getLatestCrowdloanId(paraId.toString(), store);


  // const parachain = await store.find(Parachain, {
  //   where: { id: parachainId },
  //   take: 1,
  // });

  // const parachain2 = await store.find(Parachain, {
  //   where: { id: paraId },
  //   take: 1,
  // });

  // // const auction = await store.find(Auction, {
  // //   where: { id: auctionId.toString() },
  // //   take: 1,
  // // });

  // const auctionData = await getByAuctions(store, auctionId.toString()) as Auction[];
  // if(auctionData.length != 0) {

  //   let auction = auctionData[0]
  
  //   const bid = new Bid({
  //     id: `${blockNum}-${from}-${parachainId}-${firstSlot}-${lastSlot}`,
  //     auction,
  //     blockNum,
  //     winningAuction: auctionId,
  //     parachain: parachain[0],
  //     isCrowdloan: isFund,
  //     amount: BigInt(amount.toString()),
  //     firstSlot: firstSlot.toNumber(),
  //     lastSlot: lastSlot.toNumber(),
  //     createdAt: new Date(createdAt),
  //     fund,
  //     bidder: isFund ? null : from.toHex(),
  //   });
  
  //   console.log(" bid ::: ",bid)
  //   /**
  //    * ToDo: Getting error :-
  //             name: QueryFailedError, message: insert or update on table "bid" violates foreign key constraint "FK_9e594e5a61c0f3cb25679f6ba8d", 
  //             stack: QueryFailedError: insert or update on table "bid" violates foreign key constraint "FK_9e594e5a61c0f3cb25679f6ba8d"
  //    *  */ 
  //   await store.save(bid);
  //   // const auctionParaId = `${paraId}-${firstSlot}-${lastSlot}-${auctionId}`;
  //   // const auctionPara = await store.get(AuctionParachain,{
  //   //   where: { auctionParaId }
  //   // });
  //   // if (!auctionPara) {
  //   //   await store.save(new AuctionParachain({
  //   //     id: auctionParaId,
  //   //     firstSlot: firstSlot.toNumber(),
  //   //     lastSlot: lastSlot.toNumber(),
  //   //     createdAt: new Date(block.timestamp),
  //   //     blockNum: block.height
  //   //   }))
  //   // }
  // } else {
  //   console.log(` ------ [Auctions] [BidAccepted] Event No auction found.`);
  // }

  // console.info(` ------ [Auctions] [BidAccepted] Event Completed.`);
// }