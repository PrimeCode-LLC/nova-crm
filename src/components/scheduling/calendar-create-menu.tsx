"use client";

import { CalendarClock, ChevronDown, ListTodo, Plus, Video } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function CalendarCreateMenu({
  onCreateEvent,
  onCreateTask,
  onCreateAppointmentSchedule,
  disabled,
  className,
}: {
  onCreateEvent: () => void;
  onCreateTask: () => void;
  onCreateAppointmentSchedule: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        render={
          <Button className={className} disabled={disabled}>
            <Plus className="h-4 w-4" />
            Create
            <ChevronDown className="h-4 w-4 opacity-70" />
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="min-w-52">
        <DropdownMenuItem onClick={onCreateEvent}>
          <Video className="h-4 w-4" />
          Event
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onCreateTask}>
          <ListTodo className="h-4 w-4" />
          Task
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onCreateAppointmentSchedule}>
          <CalendarClock className="h-4 w-4" />
          Appointment schedule
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
