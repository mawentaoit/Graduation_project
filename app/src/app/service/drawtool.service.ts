/*
 * Copyright (c) 2020 liwei<linewei@gmail.com>
 *
 * This program is free software: you can use, redistribute, and/or modify
 * it under the terms of the GNU Affero General Public License, version 3
 * or later ("AGPL"), as published by the Free Software Foundation.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
*/

import { Injectable } from '@angular/core';
import { fabric } from 'fabric';
import { LoggerService } from './logger.service';
import { Observable } from 'rxjs';
import { throttleTime } from 'rxjs/operators';

export enum DrawtoolType {
  free = 'free',
  select = 'select',
  text = 'text',
  line = 'line',
  rect = 'rect',
  none = 'none'
}

@Injectable({
  providedIn: 'root'
})
export class DrawtoolService {
  color = 'red';
  lineWeight = 1;
  shape: string;
  fontSize: 50;
  fontFamily: 'Arial';
  public fabCanvas: fabric.Canvas;
  private lining: fabric.Line;
  private recting: fabric.Rect;
  private texting: fabric.IText;
  private freeDraw = null;
  private selecting = null;
  public document;

  public selectedTool: DrawtoolType = DrawtoolType.line;
  syncEvent;

  constructor(
    private logger: LoggerService,
  ) {
  }

  setDocument(doc) {
    this.fabCanvas = doc.fabCanvas;
    this.document = doc;
    if ( !doc.isCanvasInited ) {
      this.setupEvent();
      doc.isCanvasInited = true;
    }
    this.setupTool();
  }

  setupTool() {
    switch (this.selectedTool) {
      case DrawtoolType.text :
        this.setDrawText();
        break;
      case DrawtoolType.rect :
        this.setDrawRect();
        break;
      case DrawtoolType.line :
        this.setDrawLine();
        break;
      case DrawtoolType.select :
        this.setDrawSelect();
        break;
      case DrawtoolType.free :
        this.setDrawFree();
        break;
      default :
        break;
    }

    this.setColor(this.color);
    this.setLineWeight(this.lineWeight);
  }

  private setupEvent() {
    this.fabCanvas.on('mouse:down', (e) => {
      this.logger.debug('mouse:down event');
      switch (this.selectedTool) {
        case DrawtoolType.text :
          return this.enterDrawText(e);
        case DrawtoolType.rect :
          return this.enterDrawRect(e);
        case DrawtoolType.line :
          return this.enterDrawLine(e);
        case DrawtoolType.free :
          this.freeDraw = true;
          break;
        case DrawtoolType.select :
          this.selecting = true;
          break;
      }
    });

    this.syncEvent = new Observable((obs) => {
      this.fabCanvas.on('mouse:move', (e) => {
        if ( e.target ) {
          if (this.selectedTool !== 'select' ) {
            e.target.hoverCursor = this.fabCanvas.defaultCursor;
          } else {
            e.target.hoverCursor = this.fabCanvas.hoverCursor;
          }
        }
        switch (this.selectedTool) {
          case DrawtoolType.line :
            if ( this.lining ) {
              const loc = this.fabCanvas.getPointer(e.e);
              this.lining.set('x2', loc.x);
              this.lining.set('y2', loc.y);
              this.lining.setCoords();
              this.fabCanvas.renderAll();
              obs.next();
            }
            break;
          case DrawtoolType.rect :
            if ( this.recting ) {
              const loc = this.fabCanvas.getPointer(e.e);
              const width = loc.x - this.recting.left;
              const height = loc.y - this.recting.top;

              this.recting.set({width, height});
              this.recting.setCoords();
              this.fabCanvas.renderAll();
              obs.next();
            }
            break;
          case DrawtoolType.free :
            if (this.freeDraw) {
            }
            break;
          case DrawtoolType.select :
            if (e.target && this.selecting) {
              obs.next();
            }
        }
      });
    }).pipe(
      throttleTime(100),
    ).subscribe(() => {
      this.document.sendSyncDocInfo();
    });


    this.fabCanvas.on('mouse:up', (e) => {
      switch (this.selectedTool) {
        case DrawtoolType.line :
          if ( this.lining ) {
            this.lining = undefined;
            this.fabCanvas.discardActiveObject();
            this.document.sendSyncDocInfo();
          }
          break;
        case DrawtoolType.rect :
          this.recting = undefined;
          this.document.sendSyncDocInfo();
          break;
        case DrawtoolType.free :
          this.freeDraw = false;
          this.document.sendSyncDocInfo();
          break;
        case DrawtoolType.select :
          this.selecting = false;
      }
    });

    this.fabCanvas.on('object:removed', (e) => {
      this.logger.debug('fabric canvas %s is removed', e.target);
      this.document.sendSyncDocInfo();
    });

    this.fabCanvas.on('object:modified', (e) => {
      this.logger.debug('fabric canvas object modified , %s', e.target);
      this.document.sendSyncDocInfo();
    });

    this.fabCanvas.on('path:created', (e) => {
      this.logger.debug('path:created event, ', e);
      (e as any).path.opacity = 0.3;
    });

    this.fabCanvas.on('object:added', (e) => {
      this.logger.debug('object added event');
    });

    this.fabCanvas.on('text:changed', (e) => {
      this.logger.debug('text changed event');
      this.document.sendSyncDocInfo();
    });
  }

  private enterDrawText(e: fabric.IEvent) {
    if (e.target && e.target.type === 'i-text') {
      return;
    }

    const loc = this.fabCanvas.getPointer(e.e);
    this.logger.debug('Draw text, e: %o, x: %s, y: %s', e, loc.x, loc.y);

    this.texting = new fabric.IText('', {
      left: loc.x,
      top: loc.y,
    });

    this.texting .setColor(this.color);

    this.fabCanvas.add(this.texting);
    this.fabCanvas.setActiveObject(this.texting);
    this.texting.enterEditing();

    this.texting.on('editing:exited', () => {
      const text = this.texting.text.trim();
      if ( !text.length ) {
        this.logger.debug('remove text because zero length');
        this.fabCanvas.remove(this.texting);
      }
    });
  }

  private enterDrawRect(e: fabric.IEvent) {
    const loc = this.fabCanvas.getPointer(e.e);
    this.logger.debug('Draw Rect, x: %s, y: %s', loc.x, loc.y);
    this.recting = new fabric.Rect({
      left: loc.x,
      top: loc.y,
      width: 0,
      height: 0,
      fill: '',
      selectable: false,
      stroke: this.color,
      opacity: 1,
      strokeWidth: this.lineWeight
      }
    );

    this.fabCanvas.add(this.recting);
  }

  private enterDrawLine(e: fabric.IEvent) {
    this.logger.debug('target: %o', e.target);

    const loc = this.fabCanvas.getPointer(e.e);
    this.logger.debug('Draw line, x: %s, y: %s', loc.x, loc.y);
    this.lining = new fabric.Line(
      [loc.x, loc.y, loc.x, loc.y],
      {
        selectable: false,
        stroke: this.color,
        strokeWidth: this.lineWeight
      }
    );

    this.fabCanvas.add(this.lining);
  }

  public recoverCanvas() {
    this.fabCanvas.isDrawingMode = false;
    this.selectedTool = DrawtoolType.none;

    this.fabCanvas.getObjects().forEach(obj => obj.selectable = false);
  }

  setDrawRect() {
    this.recoverCanvas();
    this.selectedTool = DrawtoolType.rect;
  }

  setDrawLine() {
    this.recoverCanvas();
    this.selectedTool = DrawtoolType.line;
  }

  setDrawText() {
    this.recoverCanvas();
    this.selectedTool = DrawtoolType.text;
  }

  setDrawFree() {
    this.recoverCanvas();
    this.fabCanvas.isDrawingMode = true;
    this.selectedTool = DrawtoolType.free;

    this.updataCanvasTool();
  }

  setDrawSelect() {
    this.fabCanvas.isDrawingMode = false;
    this.selectedTool = DrawtoolType.select;

    this.fabCanvas.getObjects().forEach(obj => {
      obj.selectable = true;
      if (obj.type === 'i-text') {
        const text = obj as fabric.IText;
        if ( text.isEditing ) {
          text.exitEditing();
        }
      }
    });
  }

  delObject() {
    if ( this.selectedTool !== DrawtoolType.select) {
      return;
    }

    const objects = this.fabCanvas.getActiveObjects();
    objects.forEach(object => {
      this.fabCanvas.remove(object);
    });

    if ( objects.length ) {
      this.fabCanvas.renderAll();
    }
  }

  setColor(color) {
    this.color = color;
    this.updataCanvasTool();
  }

  setLineWeight(weight) {
    this.lineWeight = weight;
    this.updataCanvasTool();
  }

  private updataCanvasTool() {
    if ( this.fabCanvas.isDrawingMode ) {
      this.fabCanvas.freeDrawingBrush.color = this.color;
      this.fabCanvas.freeDrawingBrush.width = 20;
    }
  }
}
