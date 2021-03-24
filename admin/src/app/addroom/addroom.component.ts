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
import { Component, OnInit, AfterViewInit, Inject } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { FormGroup, FormBuilder, Validators } from '@angular/forms';
import { I18nService } from '../service/i18n.service';
import { LoggerService } from '../service/logger.service';
import { HttpClient } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import { EventbusService, EventType } from '../service/eventbus.service';
import { getHost } from '../define';

@Component({
  selector: 'app-addroom',
  templateUrl: './addroom.component.html',
  styleUrls: ['./addroom.component.css']
})
export class AddroomComponent implements OnInit, AfterViewInit {
  roomForm: FormGroup;

  name: string;
  speakerPassword: string;
  attendeePassword: string;

  description;
  rooms;

  optUpdate = false;
  dataRoom;

  modules = {
    toolbar: [
      ['bold', 'italic', 'underline'],        // toggled buttons
      [{ list: 'ordered'}, { list: 'bullet' }],
      [{ color: [] }],
    ]
  };

  constructor(
    public dialogRef: MatDialogRef<AddroomComponent>,
    public i18n: I18nService,
    @Inject(MAT_DIALOG_DATA) public data,
    private fb: FormBuilder,
    private logger: LoggerService,
    private http: HttpClient,
    private snackbar: MatSnackBar,
    private eventbus: EventbusService,
  ) {
    if ( data && data.room ) {
      this.optUpdate = true;
      this.dataRoom = data.room;
      this.name = data.room.name;
      this.speakerPassword = data.room.speakerPassword;
      this.attendeePassword = data.room.attendeePassword;
      this.description = data.room.description;
    }

  }

  ngOnInit(): void {
    this.roomForm = this.fb.group({
      name: [this.name, Validators.required],
      speakerPassword: [this.speakerPassword],
      attendeePassword: [this.attendeePassword]
    });
  }

  ngAfterViewInit() {
  }

  async create() {
    const roomName = this.roomForm.get('name').value;
    const speakerPassword = this.roomForm.get('speakerPassword').value;
    const attendeePassword = this.roomForm.get('attendeePassword').value;
    const roomDesc = this.description;

    let roomId = '';
    let postUrl = '';
    if ( this.optUpdate ) {
      roomId = this.dataRoom.id;
      postUrl = getHost() + '/room/updateRoom';
    } else {
      roomId = this.makeRandomString(6);
      postUrl = getHost() + '/room/createRoom';
    }

    this.logger.debug('id: %s, name: %s, speakerPassword: %s, attendeePassword: %s, roomDesc: %s',
      roomId,
      roomName,
      speakerPassword,
      attendeePassword,
      roomDesc);

    this.http.post(postUrl, {
      roomId,
      roomName,
      speakerPassword,
      attendeePassword,
      roomDesc
    }).subscribe((res) => {
      this.eventbus.room$.next({
        type: EventType.room_created
      });

      const action = this.optUpdate ? this.i18n.lang.update : this.i18n.lang.create;
      this.snackbar.open(`${action} ${roomName} ${this.i18n.lang.success}, ID: ${roomId}`, 'close', {duration: 5000});
    }, error => {
      this.snackbar.open(`${error.name}: ${error.message}`, 'close', {duration: 5000});
    });
  }

  makeRandomString(length: number): string {
    let outString = '';
    const inOptions = '0123456789';

    for (let i = 0; i < length; i++) {
      outString += inOptions.charAt(Math.floor(Math.random() * inOptions.length));
    }

    return outString;
  }
}
