import { stageInput } from '../model/context-views';
import {z} from 'zod';
import type {ModelRunner} from '../types';
import type {WebSearchService} from '../web/service';
import {phaseOptions} from '../web/phases';
import {modelTask} from '../model/contracts';
export async function describeSticker(models:ModelRunner,web:WebSearchService|undefined,ownerId:string,imageId:string,imageDataUrl:string){return models.runModel(modelTask<{description:string}>('sticker_description',z.object({description:z.string()})),stageInput('sticker_description',{imageDataUrl}),phaseOptions(web,'asset',ownerId,`sticker:${imageId}`,'sticker_description',{lookup:null}));}
